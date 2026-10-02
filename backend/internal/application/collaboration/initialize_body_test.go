package collaboration

import (
	"context"
	"errors"
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

func TestBodyInitializationUseCaseRejectsBodiesAboveTheSupportedSize(t *testing.T) {
	documentID, rootID := uuid.New(), uuid.New()
	nodes := []documentbody.Node{{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1}}
	for i := 1; i <= documentbody.MaxCollaborativeNodes; i++ {
		nodes = append(nodes, documentbody.Node{DocumentID: documentID, NodeID: uuid.New(), ParentID: &rootID, SiblingOrder: float64(i), Type: "thematic-break", Attributes: []byte(`{}`), Version: 1})
	}
	called := false
	useCase := NewBodyInitializationUseCase(bodyInitializerFunc(func(context.Context, Actor, BodyInitialization) error {
		called = true
		return nil
	}))
	err := useCase.Initialize(context.Background(), Actor{UserID: uuid.New()}, BodyInitialization{
		WorkspaceID: uuid.New(), DocumentID: documentID, BaseBodyVersion: 1, BodySchemaVersion: 1,
		Body: documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: nodes},
	})
	if !errors.Is(err, documentbody.ErrTooLarge) || called {
		t.Fatalf("Initialize() = %v (repository called: %v), want ErrTooLarge without reaching the repository", err, called)
	}
}
