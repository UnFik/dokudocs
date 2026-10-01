package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) RemoveMember(ctx context.Context, projectID, workspaceID, memberUserID, actorID uuid.UUID) (err error) {
	if _, err := u.GetProject(ctx, projectID, workspaceID, actorID); err != nil {
		return err
	}
	canManage, err := u.canManageProject(ctx, projectID, workspaceID, actorID)
	if (err != nil || !canManage) && actorID != memberUserID {
		return constant.ErrForbidden
	}
	return u.projectRepo.RemoveMember(ctx, projectID, workspaceID, actorID, memberUserID)
}
