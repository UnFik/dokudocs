package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) SearchDocuments(ctx context.Context, workspaceID, userID uuid.UUID, query string, limit int) (data []model.DocumentSearchHit, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return u.docRepo.Search(ctx, workspaceID, userID, query, limit)
}
