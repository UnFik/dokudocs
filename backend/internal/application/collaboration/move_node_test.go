package collaboration

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

type moveNodeWriterFunc func(context.Context, Actor, MoveNodeCommand) (MoveNodeResult, error)

func (f moveNodeWriterFunc) MoveNode(ctx context.Context, actor Actor, command MoveNodeCommand) (MoveNodeResult, error) {
	return f(ctx, actor, command)
}

func TestMoveNodeUseCase(t *testing.T) {
	actorID, workspaceID, documentID, commandID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	command := MoveNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: commandID,
		BodyEpoch: 2, BodySchemaVersion: 1, NodeID: uuid.New(), TargetParentID: uuid.New(),
	}
	want := MoveNodeResult{DocumentID: documentID, CommandID: commandID, BodyEpoch: 3, BodyVersion: 8, Changed: true}
	useCase := NewMoveNodeUseCase(moveNodeWriterFunc(func(_ context.Context, actor Actor, got MoveNodeCommand) (MoveNodeResult, error) {
		if actor.UserID != actorID || got != command {
			t.Fatal("MoveNode command did not reach writer intact")
		}
		return want, nil
	}))

	got, err := useCase.Move(context.Background(), Actor{UserID: actorID}, command)
	if err != nil || got != want {
		t.Fatalf("Move() = %+v, %v; want %+v", got, err, want)
	}
}

func TestMoveNodeUseCaseRejectsInvalidEnvelopeAndReceipt(t *testing.T) {
	command := MoveNodeCommand{
		WorkspaceID: uuid.New(), DocumentID: uuid.New(), CommandID: uuid.New(),
		BodyEpoch: 1, BodySchemaVersion: 1, NodeID: uuid.New(), TargetParentID: uuid.New(),
	}
	for _, test := range []struct {
		name    string
		actor   Actor
		command MoveNodeCommand
		result  MoveNodeResult
		wantErr error
	}{
		{name: "missing actor", command: command, wantErr: ErrInvalidMoveNode},
		{name: "missing command ID", actor: Actor{UserID: uuid.New()}, command: func() MoveNodeCommand { v := command; v.CommandID = uuid.Nil; return v }(), wantErr: ErrInvalidMoveNode},
		{name: "mismatched receipt", actor: Actor{UserID: uuid.New()}, command: command, result: MoveNodeResult{DocumentID: uuid.New(), CommandID: command.CommandID, BodyEpoch: 1, BodyVersion: 1}, wantErr: ErrInvalidMoveNode},
	} {
		t.Run(test.name, func(t *testing.T) {
			useCase := NewMoveNodeUseCase(moveNodeWriterFunc(func(context.Context, Actor, MoveNodeCommand) (MoveNodeResult, error) {
				return test.result, nil
			}))
			_, err := useCase.Move(context.Background(), test.actor, test.command)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("Move() error = %v, want %v", err, test.wantErr)
			}
		})
	}
}
