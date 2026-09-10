package usecase

import (
	"context"

	"backend/internal/domain/contract/repository"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) ListDocuments(ctx context.Context, workspaceID, userID uuid.UUID, filter repository.DocumentFilter) (data []model.Document, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	data, err = u.docRepo.List(ctx, workspaceID, userID, filter)
	if err != nil {
		return data, err
	}
	return data, nil
}
