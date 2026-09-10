package usecase

import (
	"context"
	"strings"

	"backend/constant"
	"backend/internal/application/workspace/dto"
)

func (u *useCase) AddMember(ctx context.Context, input dto.AddMemberInput) (err error) {
	actorRole, err := u.workspaceRepo.GetUserRole(ctx, input.WorkspaceID, input.ActorID)
	if err != nil {
		return err
	}
	if actorRole != "owner" && actorRole != "admin" {
		return constant.ErrForbidden
	}

	user, err := u.userRepo.FindByEmail(ctx, strings.TrimSpace(strings.ToLower(input.Email)))
	if err != nil {
		return constant.ErrUserNotFound
	}
	role := input.Role
	if role == "" {
		role = "member"
	}
	return u.workspaceRepo.AddMember(ctx, input.WorkspaceID, user.ID, role)
}
