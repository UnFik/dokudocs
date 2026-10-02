package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) ReorderCategories(ctx context.Context, projectID, workspaceID, userID uuid.UUID, categoryIDs []uuid.UUID) (err error) {
	if _, err := u.GetProject(ctx, projectID, workspaceID, userID); err != nil {
		return err
	}
	canEdit, err := u.canEditProject(ctx, projectID, workspaceID, userID)
	if err != nil || !canEdit {
		return constant.ErrForbidden
	}
	return u.projectRepo.ReorderCategories(ctx, projectID, workspaceID, userID, categoryIDs)
}
