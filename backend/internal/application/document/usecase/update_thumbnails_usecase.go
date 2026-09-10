package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) UpdateThumbnails(ctx context.Context, id, workspaceID, userID uuid.UUID, thumb, thumbDark, thumbPreview, thumbPreviewDark string) (err error) {
	doc, err := u.GetDocument(ctx, id, workspaceID, userID)
	if err != nil {
		return err
	}
	canManage, err := u.canManageDoc(ctx, doc, workspaceID, userID)
	if err != nil || !canManage {
		return constant.ErrForbidden
	}
	return u.docRepo.UpdateThumbnails(ctx, id, thumb, thumbDark, thumbPreview, thumbPreviewDark)
}
