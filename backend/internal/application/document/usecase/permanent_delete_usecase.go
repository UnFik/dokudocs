package usecase

import (
	"context"

	"backend/constant"
	"backend/internal/domain/policy"

	"github.com/google/uuid"
)

func (u *useCase) PermanentDelete(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error) {
	doc, access, err := u.getTrashedDocumentAccess(ctx, id, workspaceID, userID)
	if err != nil {
		return err
	}
	if !policy.CanPermanentlyDeleteDocument(doc, access) {
		return constant.ErrForbidden
	}
	return u.docRepo.PermanentDelete(ctx, id, workspaceID, userID)
}
