package collaboration

import (
	"context"
	"errors"

	"backend/internal/domain/documentbody"

	"github.com/google/uuid"
)

var ErrInvalidBodyInitialization = errors.New("invalid document body initialization")

type BodyInitialization struct {
	WorkspaceID       uuid.UUID
	DocumentID        uuid.UUID
	BaseBodyVersion   int64
	BodySchemaVersion int
	SourceFingerprint [32]byte
	Body              documentbody.Body
}

type BodyInitializer interface {
	InitializeBody(context.Context, Actor, BodyInitialization) error
}

type BodyInitializationUseCase struct {
	initializer BodyInitializer
}

func NewBodyInitializationUseCase(initializer BodyInitializer) *BodyInitializationUseCase {
	return &BodyInitializationUseCase{initializer: initializer}
}

func (u *BodyInitializationUseCase) Initialize(ctx context.Context, actor Actor, input BodyInitialization) error {
	if actor.UserID == uuid.Nil || input.WorkspaceID == uuid.Nil || input.DocumentID == uuid.Nil || input.BaseBodyVersion < 1 ||
		input.BodySchemaVersion < 1 || input.Body.DocumentID != input.DocumentID ||
		input.Body.RootNodeID == uuid.Nil || len(input.Body.Nodes) == 0 {
		return ErrInvalidBodyInitialization
	}
	if err := documentbody.Validate(input.Body); err != nil {
		return ErrInvalidBodyInitialization
	}
	return u.initializer.InitializeBody(ctx, actor, input)
}
