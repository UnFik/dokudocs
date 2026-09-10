package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) ListAccesses(ctx context.Context, docID, workspaceID, userID uuid.UUID) (data []model.DocumentAccess, err error) {
	if _, err = u.GetDocument(ctx, docID, workspaceID, userID); err != nil {
		return nil, err
	}
	data, err = u.docRepo.ListAccesses(ctx, docID)
	if err != nil {
		return data, err
	}
	return data, nil
}
