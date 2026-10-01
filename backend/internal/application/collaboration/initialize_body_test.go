package collaboration

import (
	"context"
	"testing"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

type bodyInitializerFunc func(context.Context, Actor, BodyInitialization) error

func (f bodyInitializerFunc) InitializeBody(ctx context.Context, actor Actor, input BodyInitialization) error {
	return f(ctx, actor, input)
}

func TestBodyInitializationUseCaseRejectsInvalidEnvelope(t *testing.T) {
	documentID := uuid.New()
	called := false
	useCase := NewBodyInitializationUseCase(bodyInitializerFunc(func(context.Context, Actor, BodyInitialization) error {
		called = true
		return nil
	}))

	input := BodyInitialization{
		WorkspaceID: uuid.New(), DocumentID: documentID, BaseBodyVersion: 1, BodySchemaVersion: 1,
		Body: documentbody.Body{DocumentID: uuid.New(), RootNodeID: uuid.New(), Nodes: []documentbody.Node{{}}},
	}
	if err := useCase.Initialize(context.Background(), Actor{UserID: uuid.New()}, input); err != ErrInvalidBodyInitialization {
		t.Fatalf("Initialize() error = %v, want %v", err, ErrInvalidBodyInitialization)
	}
	if called {
		t.Fatal("invalid initialization reached the repository")
	}
}
