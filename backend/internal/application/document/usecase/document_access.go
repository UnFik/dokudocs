package usecase

import (
	"context"
	"errors"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"

	"github.com/google/uuid"
)

func (u *useCase) resolveDocumentAccess(ctx context.Context, doc model.Document, workspaceRole string, userID uuid.UUID) (policy.DocumentAccessContext, error) {
	access := policy.DocumentAccessContext{UserID: userID, WorkspaceRole: workspaceRole}
	grant, err := u.docRepo.GetUserAccessLevel(ctx, doc.ID, userID)
	if err != nil && !errors.Is(err, constant.ErrAccessNotFound) {
		return access, err
	}
	if err == nil {
		access.DocumentGrant = grant
	}

	if doc.ProjectID == nil {
		return access, nil
	}
	project, err := u.projectRepo.GetByID(ctx, *doc.ProjectID, userID)
	if errors.Is(err, constant.ErrProjectNotFound) {
		return access, nil
	}
	if err != nil {
		return access, err
	}
	if project.WorkspaceID == doc.WorkspaceID && project.DeletedAt == nil {
		access.ProjectVisibility = project.Visibility
		access.ProjectRole = project.Role
	}
	return access, nil
}
