package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) RemoveAccess(ctx context.Context, docID, workspaceID, memberUserID, actorID uuid.UUID) (err error) {
	doc, err := u.GetDocument(ctx, docID, workspaceID, actorID)
	if err != nil {
		return err
	}
	canManage, err := u.canManageDoc(ctx, doc, workspaceID, actorID)
	if (err != nil || !canManage) && actorID != memberUserID {
		return constant.ErrForbidden
	}
	return u.docRepo.RemoveAccess(ctx, docID, workspaceID, actorID, memberUserID)
}
