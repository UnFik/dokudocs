package collaboration

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

type deleteNodeWriterFunc func(context.Context, Actor, DeleteNodeCommand) (DeleteNodeResult, error)

func (f deleteNodeWriterFunc) DeleteNode(ctx context.Context, actor Actor, command DeleteNodeCommand) (DeleteNodeResult, error) {
	return f(ctx, actor, command)
}

func TestDeleteNodeUseCase(t *testing.T) {
	actorID, workspaceID, documentID, commandID, nodeID := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	command := DeleteNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: commandID,
		BodyEpoch: 2, BodySchemaVersion: 1, NodeIDs: []uuid.UUID{nodeID},
	}
	want := DeleteNodeResult{DocumentID: documentID, CommandID: commandID, NodeID: nodeID, NodeIDs: []uuid.UUID{nodeID}, BodyEpoch: 3, BodyVersion: 8, Changed: true}
	useCase := NewDeleteNodeUseCase(deleteNodeWriterFunc(func(_ context.Context, actor Actor, got DeleteNodeCommand) (DeleteNodeResult, error) {
		if actor.UserID != actorID || !reflect.DeepEqual(got, command) {
			t.Fatal("DeleteNode command did not reach writer intact")
		}
		return want, nil
	}))

	got, err := useCase.Delete(context.Background(), Actor{UserID: actorID}, command)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("Delete() = %+v, %v; want %+v", got, err, want)
	}
}

func TestDeleteNodeUseCaseRejectsInvalidEnvelopeAndReceipt(t *testing.T) {
	command := DeleteNodeCommand{
		WorkspaceID: uuid.New(), DocumentID: uuid.New(), CommandID: uuid.New(),
		BodyEpoch: 1, BodySchemaVersion: 1, NodeIDs: []uuid.UUID{uuid.New()},
	}
	for _, test := range []struct {
		name    string
		actor   Actor
		command DeleteNodeCommand
		result  DeleteNodeResult
		wantErr error
	}{
		{name: "missing actor", command: command, wantErr: ErrInvalidDeleteNode},
		{name: "missing node", actor: Actor{UserID: uuid.New()}, command: func() DeleteNodeCommand { v := command; v.NodeIDs = []uuid.UUID{uuid.Nil}; return v }(), wantErr: ErrInvalidDeleteNode},
		{name: "mismatched receipt", actor: Actor{UserID: uuid.New()}, command: command, result: DeleteNodeResult{DocumentID: uuid.New(), CommandID: command.CommandID, NodeID: command.NodeIDs[0], NodeIDs: command.NodeIDs, BodyEpoch: 1, BodyVersion: 1}, wantErr: ErrInvalidDeleteNode},
	} {
		t.Run(test.name, func(t *testing.T) {
			useCase := NewDeleteNodeUseCase(deleteNodeWriterFunc(func(context.Context, Actor, DeleteNodeCommand) (DeleteNodeResult, error) {
				return test.result, nil
			}))
			_, err := useCase.Delete(context.Background(), test.actor, test.command)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Delete() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}

func TestDeleteNodeUseCaseBatch(t *testing.T) {
	actorID, workspaceID, documentID, commandID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	first, second := uuid.New(), uuid.New()
	command := DeleteNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: commandID,
		BodyEpoch: 2, BodySchemaVersion: 1, NodeIDs: []uuid.UUID{first, second},
	}
	receipt := DeleteNodeResult{
		DocumentID: documentID, CommandID: commandID, NodeID: first, NodeIDs: []uuid.UUID{first, second},
		BodyEpoch: 3, BodyVersion: 8, Changed: true,
	}
	run := func(result DeleteNodeResult, command DeleteNodeCommand) error {
		useCase := NewDeleteNodeUseCase(deleteNodeWriterFunc(func(context.Context, Actor, DeleteNodeCommand) (DeleteNodeResult, error) {
			return result, nil
		}))
		_, err := useCase.Delete(context.Background(), Actor{UserID: actorID}, command)
		return err
	}

	if err := run(receipt, command); err != nil {
		t.Fatalf("Delete() batch = %v, want nil", err)
	}
	partial := receipt
	partial.NodeIDs = []uuid.UUID{first}
	if err := run(partial, command); !errors.Is(err, ErrInvalidDeleteNode) {
		t.Fatalf("receipt for fewer nodes error = %v, want %v", err, ErrInvalidDeleteNode)
	}
	tooMany := command
	tooMany.NodeIDs = make([]uuid.UUID, MaxDeleteNodeIDs+1)
	for i := range tooMany.NodeIDs {
		tooMany.NodeIDs[i] = uuid.New()
	}
	if err := run(receipt, tooMany); !errors.Is(err, ErrInvalidDeleteNode) {
		t.Fatalf("oversized batch error = %v, want %v", err, ErrInvalidDeleteNode)
	}
}
