package usecase

import (
	"context"

	"github.com/google/uuid"
)

func (u *useCase) ToggleStar(ctx context.Context, id, workspaceID, userID uuid.UUID) (data bool, err error) {
	if _, err = u.GetProject(ctx, id, workspaceID, userID); err != nil {
		return false, err
	}
	data, err = u.projectRepo.ToggleStar(ctx, id, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
