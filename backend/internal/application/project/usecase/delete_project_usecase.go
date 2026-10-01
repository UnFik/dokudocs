package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) DeleteProject(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error) {
	_, err = u.GetProject(ctx, id, workspaceID, userID)
	if err != nil {
		return err
	}

	canManage, err := u.canManageProject(ctx, id, workspaceID, userID)
	if err != nil || !canManage {
		return constant.ErrForbidden
	}

	return u.projectRepo.SoftDelete(ctx, id, workspaceID, userID)
}
