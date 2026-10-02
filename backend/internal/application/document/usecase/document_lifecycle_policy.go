package usecase

import (
	"context"
	"errors"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"

	"github.com/google/uuid"
)

func (u *useCase) getTrashedDocumentAccess(ctx context.Context, id, workspaceID, userID uuid.UUID) (model.Document, policy.DocumentAccessContext, error) {
	var access policy.DocumentAccessContext
	role, err := u.checkWorkspaceMembership(ctx, workspaceID, userID)
	if err != nil {
		return model.Document{}, access, err
	}
	doc, err := u.docRepo.GetTrashedByID(ctx, id)
	if err != nil {
		return model.Document{}, access, err
	}
	if doc.WorkspaceID != workspaceID {
		return model.Document{}, access, constant.ErrDocumentNotFound
	}
	accessLevel, err := u.docRepo.GetUserAccessLevel(ctx, id, userID)
	if err != nil && !errors.Is(err, constant.ErrAccessNotFound) {
		return model.Document{}, access, err
	}
	if err == nil {
		access.DocumentGrant = accessLevel
	}
	access.UserID = userID
	access.WorkspaceRole = role
	return doc, access, nil
}
