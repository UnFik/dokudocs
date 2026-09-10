package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) GetMembers(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID) (data []model.WorkspaceMember, err error) {
	_, err = u.workspaceRepo.GetUserRole(ctx, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	data, err = u.workspaceRepo.GetMembers(ctx, workspaceID)
	if err != nil {
		return data, err
	}
	return data, nil
}
