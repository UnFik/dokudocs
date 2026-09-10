package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) DeleteWorkspace(ctx context.Context, id uuid.UUID, userID uuid.UUID) (err error) {
	role, err := u.workspaceRepo.GetUserRole(ctx, id, userID)
	if err != nil {
		return err
	}
	if role != "owner" {
		return constant.ErrForbidden
	}
	return u.workspaceRepo.Delete(ctx, id)
}
