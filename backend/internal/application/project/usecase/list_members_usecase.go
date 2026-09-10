package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) ListMembers(ctx context.Context, projectID, workspaceID, userID uuid.UUID) (data []model.ProjectMember, err error) {
	if _, err = u.GetProject(ctx, projectID, workspaceID, userID); err != nil {
		return nil, err
	}
	data, err = u.projectRepo.ListMembers(ctx, projectID)
	if err != nil {
		return data, err
	}
	return data, nil
}
