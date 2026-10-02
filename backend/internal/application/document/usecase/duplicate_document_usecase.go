package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) DuplicateDocument(ctx context.Context, id, workspaceID, userID, requestID uuid.UUID) (data model.Document, err error) {
	return u.docRepo.DuplicateAuthorized(ctx, id, workspaceID, userID, requestID)
}
