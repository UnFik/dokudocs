package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) DeleteCategory(ctx context.Context, projectID, categoryID, workspaceID, userID uuid.UUID) (err error) {
	if _, err := u.GetProject(ctx, projectID, workspaceID, userID); err != nil {
		return err
	}
	canEdit, err := u.canEditProject(ctx, projectID, workspaceID, userID)
	if err != nil || !canEdit {
		return constant.ErrForbidden
	}
	return u.projectRepo.DeleteCategory(ctx, projectID, workspaceID, userID, categoryID)
}
