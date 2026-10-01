package usecase

import (
	"context"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"

	"github.com/google/uuid"
)

func (u *useCase) GetDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (data model.Document, err error) {
	workspaceRole, err := u.checkWorkspaceMembership(ctx, workspaceID, userID)
	if err != nil {
		return data, err
	}
	doc, err := u.docRepo.GetByID(ctx, id, userID)
	if err != nil {
		return data, err
	}
	if doc.WorkspaceID != workspaceID {
		return data, constant.ErrDocumentNotFound
	}

	canRead, err := u.canReadDocument(ctx, doc, workspaceRole, userID)
	if err != nil {
		return data, err
	}
	if !canRead {
		return data, constant.ErrDocumentNotFound
	}
	data = doc
	return data, nil
}

func (u *useCase) canReadDocument(ctx context.Context, doc model.Document, workspaceRole string, userID uuid.UUID) (bool, error) {
	access, err := u.resolveDocumentAccess(ctx, doc, workspaceRole, userID)
	if err != nil {
		return false, err
	}
	return policy.CanReadDocument(doc, access), nil
}
