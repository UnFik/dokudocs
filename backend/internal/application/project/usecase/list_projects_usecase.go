package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) ListProjects(ctx context.Context, workspaceID, userID uuid.UUID) (data []model.Project, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	data, err = u.projectRepo.ListByWorkspace(ctx, workspaceID, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
