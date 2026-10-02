package collaboration

import (
	"context"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

type bodyReaderFunc func(context.Context, Actor, uuid.UUID, uuid.UUID) (BodySnapshot, error)

func (f bodyReaderFunc) ReadBody(ctx context.Context, actor Actor, workspaceID, documentID uuid.UUID) (BodySnapshot, error) {
	return f(ctx, actor, workspaceID, documentID)
}

func TestBodyReadUseCaseRejectsInvalidEnvelope(t *testing.T) {
	called := false
	useCase := NewBodyReadUseCase(bodyReaderFunc(func(context.Context, Actor, uuid.UUID, uuid.UUID) (BodySnapshot, error) {
		called = true
		return BodySnapshot{}, nil
	}))
	if _, err := useCase.Read(context.Background(), Actor{}, uuid.New(), uuid.New()); err != ErrInvalidBodyRead {
		t.Fatalf("Read() error = %v, want %v", err, ErrInvalidBodyRead)
	}
	if called {
		t.Fatal("invalid read reached the repository")
	}
}

func TestBodyReadUseCaseRejectsInvalidSnapshot(t *testing.T) {
	documentID, workspaceID, userID, rootID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	useCase := NewBodyReadUseCase(bodyReaderFunc(func(context.Context, Actor, uuid.UUID, uuid.UUID) (BodySnapshot, error) {
		return BodySnapshot{
			BodyVersion: 0, BodyEpoch: 1, BodySchemaVersion: 1, EncodedState: []byte{1},
			Body: documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
				{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
			}},
		}, nil
	}))

	if _, err := useCase.Read(context.Background(), Actor{UserID: userID}, workspaceID, documentID); err != ErrInvalidBodySnapshot {
		t.Fatalf("Read() error = %v, want %v", err, ErrInvalidBodySnapshot)
	}
}
