package usecase

import (
	"context"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) GetProject(ctx context.Context, id, workspaceID, userID uuid.UUID) (data model.Project, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, workspaceID, userID); err != nil {
		return data, err
	}
	p, err := u.projectRepo.GetByID(ctx, id, userID)
	if err != nil {
		return data, err
	}
	if p.WorkspaceID != workspaceID {
		return data, constant.ErrProjectNotFound
	}
	data = p
	return data, nil
}
