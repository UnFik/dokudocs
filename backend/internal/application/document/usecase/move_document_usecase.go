package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) MoveDocument(ctx context.Context, id, workspaceID, userID uuid.UUID, targetProjectID *uuid.UUID) (err error) {
	doc, err := u.GetDocument(ctx, id, workspaceID, userID)
	if err != nil {
		return err
	}
	canManage, err := u.canManageDoc(ctx, doc, workspaceID, userID)
	if err != nil || !canManage {
		return constant.ErrForbidden
	}
	return u.docRepo.Move(ctx, id, targetProjectID)
}
