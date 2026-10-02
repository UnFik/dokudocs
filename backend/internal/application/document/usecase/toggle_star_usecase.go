package usecase

import (
	"context"

	"github.com/google/uuid"
)

func (u *useCase) ToggleStar(ctx context.Context, id, workspaceID, userID uuid.UUID) (data bool, err error) {
	return u.docRepo.ToggleStar(ctx, id, workspaceID, userID)
}
