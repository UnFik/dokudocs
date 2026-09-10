package usecase

import (
	"context"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) GetDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (data model.Document, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, workspaceID, userID); err != nil {
		return data, err
	}
	doc, err := u.docRepo.GetByID(ctx, id, userID)
	if err != nil {
		return data, err
	}
	if doc.WorkspaceID != workspaceID {
		return data, constant.ErrDocumentNotFound
	}
	data = doc
	return data, nil
}
