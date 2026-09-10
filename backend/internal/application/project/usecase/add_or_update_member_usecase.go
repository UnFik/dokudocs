package usecase

import (
	"context"
	"errors"
	"strings"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) AddOrUpdateMember(ctx context.Context, projectID, workspaceID, actorID uuid.UUID, email, role string) (err error) {
	if _, err := u.GetProject(ctx, projectID, workspaceID, actorID); err != nil {
		return err
	}
	canManage, err := u.canManageProject(ctx, projectID, workspaceID, actorID)
	if err != nil || !canManage {
		return constant.ErrForbidden
	}

	targetUser, err := u.userRepo.FindByEmail(ctx, strings.TrimSpace(strings.ToLower(email)))
	if err != nil {
		return constant.ErrUserNotFound
	}

	// Verify target user is at least a member of workspace
	if _, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, targetUser.ID); err != nil {
		return errors.New("user must be a member of the workspace before joining project")
	}

	if role == "" {
		role = "editor"
	}

	return u.projectRepo.AddOrUpdateMember(ctx, projectID, targetUser.ID, role)
}
