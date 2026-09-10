package usecase

import (
	"context"

	"github.com/google/uuid"
)

func (u *useCase) GetUserRole(ctx context.Context, workspaceID, userID uuid.UUID) (data string, err error) {
	data, err = u.workspaceRepo.GetUserRole(ctx, workspaceID, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
