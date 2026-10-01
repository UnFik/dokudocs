package usecase

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) CreateShareToken(ctx context.Context, id, workspaceID, userID uuid.UUID) (data string, err error) {
	doc, err := u.GetDocument(ctx, id, workspaceID, userID)
	if err != nil {
		return "", err
	}
	canManage, err := u.canManageDoc(ctx, doc, workspaceID, userID)
	if err != nil || !canManage {
		return "", constant.ErrForbidden
	}

	b := make([]byte, 24)
	if _, err = rand.Read(b); err != nil {
		return "", err
	}
	token := hex.EncodeToString(b)

	return u.docRepo.SetShareToken(ctx, id, workspaceID, userID, token, "public_link")
}
