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
		BodyEpoch: 2, BodySchemaVersion: 1, NodeID: nodeID,
	}
	want := DeleteNodeResult{DocumentID: documentID, CommandID: commandID, NodeID: nodeID, BodyEpoch: 3, BodyVersion: 8, Changed: true}
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
		BodyEpoch: 1, BodySchemaVersion: 1, NodeID: uuid.New(),
	}
	for _, test := range []struct {
		name    string
		actor   Actor
		command DeleteNodeCommand
		result  DeleteNodeResult
		wantErr error
	}{
		{name: "missing actor", command: command, wantErr: ErrInvalidDeleteNode},
		{name: "missing node", actor: Actor{UserID: uuid.New()}, command: func() DeleteNodeCommand { v := command; v.NodeID = uuid.Nil; return v }(), wantErr: ErrInvalidDeleteNode},
		{name: "mismatched receipt", actor: Actor{UserID: uuid.New()}, command: command, result: DeleteNodeResult{DocumentID: uuid.New(), CommandID: command.CommandID, NodeID: command.NodeID, BodyEpoch: 1, BodyVersion: 1}, wantErr: ErrInvalidDeleteNode},
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

func TestDeleteNodeCommandValidity(t *testing.T) {
	one, two := uuid.New(), uuid.New()
	for name, test := range map[string]struct {
		command DeleteNodeCommand
		want    bool
	}{
		"single":            {DeleteNodeCommand{NodeID: one}, true},
		"batch":             {DeleteNodeCommand{NodeIDs: []uuid.UUID{one, two}}, true},
		"empty":             {DeleteNodeCommand{}, false},
		"both":              {DeleteNodeCommand{NodeID: one, NodeIDs: []uuid.UUID{one, two}}, false},
		"batch of one":      {DeleteNodeCommand{NodeIDs: []uuid.UUID{one}}, false},
		"duplicate":         {DeleteNodeCommand{NodeIDs: []uuid.UUID{one, one}}, false},
		"nil id in a batch": {DeleteNodeCommand{NodeIDs: []uuid.UUID{one, uuid.Nil}}, false},
	} {
		if got := test.command.Valid(); got != test.want {
			t.Errorf("%s: Valid() = %v, want %v", name, got, test.want)
		}
	}
}
