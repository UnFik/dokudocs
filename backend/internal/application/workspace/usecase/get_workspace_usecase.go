package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) GetWorkspace(ctx context.Context, id uuid.UUID, userID uuid.UUID) (data model.Workspace, err error) {
	data, err = u.workspaceRepo.GetByID(ctx, id, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
