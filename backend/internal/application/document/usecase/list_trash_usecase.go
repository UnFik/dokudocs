package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) ListTrash(ctx context.Context, workspaceID, userID uuid.UUID) (data []model.TrashItem, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	data, err = u.docRepo.ListTrash(ctx, workspaceID, userID)
	if err != nil {
		return data, err
	}
	return data, nil
}
