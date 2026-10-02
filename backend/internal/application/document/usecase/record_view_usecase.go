package usecase

import (
	"context"

	"github.com/google/uuid"
)

func (u *useCase) RecordView(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error) {
	return u.docRepo.RecordView(ctx, id, workspaceID, userID)
}
