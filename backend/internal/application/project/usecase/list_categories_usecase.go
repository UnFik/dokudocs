package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) ListCategories(ctx context.Context, projectID, workspaceID, userID uuid.UUID) (data []model.ProjectCategory, err error) {
	if _, err = u.GetProject(ctx, projectID, workspaceID, userID); err != nil {
		return nil, err
	}
	data, err = u.projectRepo.ListCategories(ctx, projectID, workspaceID, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
