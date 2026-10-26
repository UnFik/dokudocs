package usecase

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// GetMemberProfile is for the members of the workspace: someone outside it is
// refused, whoever they ask about.
func (u *useCase) GetMemberProfile(ctx context.Context, workspaceID, actorID, userID uuid.UUID) (data model.MemberProfile, err error) {
	if _, err = u.workspaceRepo.GetUserRole(ctx, workspaceID, actorID); err != nil {
		return data, err
	}
	return u.workspaceRepo.GetMemberProfile(ctx, workspaceID, userID)
}
