package usecase

import (
	"context"
	"strings"

	"backend/constant"
	"backend/internal/application/project/dto"
	"backend/internal/domain/model"
)

func (u *useCase) UpdateProject(ctx context.Context, input dto.UpdateProjectInput) (data model.Project, err error) {
	p, err := u.GetProject(ctx, input.ID, input.WorkspaceID, input.UserID)
	if err != nil {
		return data, err
	}

	canManage, err := u.canManageProject(ctx, input.ID, input.WorkspaceID, input.UserID)
	if err != nil || !canManage {
		return data, constant.ErrForbidden
	}

	if input.Name != "" {
		p.Name = strings.TrimSpace(input.Name)
	}
	if input.Description != "" {
		p.Description = input.Description
	}
	if input.LogoURL != "" {
		p.LogoURL = input.LogoURL
	}
	if input.ColorBadge != "" {
		p.ColorBadge = input.ColorBadge
	}
	if input.Visibility != "" {
		p.Visibility = input.Visibility
	}

	if err = u.projectRepo.Update(ctx, p); err != nil {
		return data, err
	}
	data, err = u.GetProject(ctx, input.ID, input.WorkspaceID, input.UserID)
	if err != nil {
		return data, err
	}
	return data, nil
}
