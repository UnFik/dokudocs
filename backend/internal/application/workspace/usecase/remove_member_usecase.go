package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) RemoveMember(ctx context.Context, workspaceID uuid.UUID, memberUserID uuid.UUID, actorID uuid.UUID) (err error) {
	actorRole, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, actorID)
	if err != nil {
		return err
	}
	if actorRole != "owner" && actorRole != "admin" && actorID != memberUserID {
		return constant.ErrForbidden
	}
	return u.workspaceRepo.RemoveMember(ctx, workspaceID, actorID, memberUserID)
}
