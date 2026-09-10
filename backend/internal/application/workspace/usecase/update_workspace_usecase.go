package usecase

import (
	"context"
	"strings"

	"backend/constant"
	"backend/internal/application/workspace/dto"
	"backend/internal/domain/model"
)

func (u *useCase) UpdateWorkspace(ctx context.Context, input dto.UpdateWorkspaceInput) (data model.Workspace, err error) {
	role, err := u.workspaceRepo.GetUserRole(ctx, input.ID, input.UserID)
	if err != nil {
		return data, err
	}
	if role != "owner" && role != "admin" {
		return data, constant.ErrForbidden
	}

	ws, err := u.workspaceRepo.GetByID(ctx, input.ID, input.UserID)
	if err != nil {
		return data, err
	}
	if input.Name != "" {
		ws.Name = strings.TrimSpace(input.Name)
	}
	if input.Plan != "" {
		ws.Plan = input.Plan
	}
	if input.LogoURL != "" {
		ws.LogoURL = input.LogoURL
	}
	if err = u.workspaceRepo.Update(ctx, ws); err != nil {
		return data, err
	}
	data = ws
	return data, nil
}
