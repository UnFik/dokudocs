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
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)

	if err = u.docRepo.SetShareToken(ctx, id, token, "public_link"); err != nil {
		return "", err
	}
	data = token
	return data, nil
}
