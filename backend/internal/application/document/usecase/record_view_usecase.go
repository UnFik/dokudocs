package usecase

import (
	"context"

	"github.com/google/uuid"
)

func (u *useCase) RecordView(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error) {
	if _, err = u.GetDocument(ctx, id, workspaceID, userID); err != nil {
		return err
	}
	return u.docRepo.RecordView(ctx, id, userID)
}
