package usecase

import (
	"context"

	"github.com/google/uuid"
)

func (u *useCase) RestoreDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error) {
	if _, err = u.checkWorkspaceMembership(ctx, workspaceID, userID); err != nil {
		return err
	}
	return u.docRepo.Restore(ctx, id)
}
