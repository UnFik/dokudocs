package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) ListWorkspaces(ctx context.Context, userID uuid.UUID) (data []model.Workspace, err error) {
	data, err = u.workspaceRepo.ListByUser(ctx, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
