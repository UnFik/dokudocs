package usecase

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (u *useCase) EmptyTrash(ctx context.Context, workspaceID, userID uuid.UUID) (err error) {
	wsRole, err := u.workspaceRepo.GetUserRole(ctx, workspaceID, userID)
	if err != nil || (wsRole != "owner" && wsRole != "admin") {
		return constant.ErrForbidden
	}
	return u.docRepo.EmptyTrash(ctx, workspaceID, userID)
}
