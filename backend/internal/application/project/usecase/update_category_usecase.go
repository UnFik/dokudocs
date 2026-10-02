package usecase

import (
	"context"
	"strings"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) UpdateCategory(ctx context.Context, projectID, categoryID, workspaceID, userID uuid.UUID, name, colorID string) (err error) {
	if _, err := u.GetProject(ctx, projectID, workspaceID, userID); err != nil {
		return err
	}
	canEdit, err := u.canEditProject(ctx, projectID, workspaceID, userID)
	if err != nil || !canEdit {
		return constant.ErrForbidden
	}
	return u.projectRepo.UpdateCategory(ctx, projectID, workspaceID, userID, categoryID, strings.TrimSpace(name), colorID)
}
