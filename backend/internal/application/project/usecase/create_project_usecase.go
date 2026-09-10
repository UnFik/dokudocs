package usecase

import (
	"context"
	"fmt"
	"strings"

	"backend/internal/application/project/dto"
	"backend/internal/domain/model"
)

func (u *useCase) CreateProject(ctx context.Context, input dto.CreateProjectInput) (data model.Project, err error) {
	if _, err = u.checkWorkspaceMembership(ctx, input.WorkspaceID, input.UserID); err != nil {
		return data, err
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return data, fmt.Errorf("project name is required")
	}

	categories := input.Categories
	if len(categories) == 0 {
		categories = []string{"General"}
	}

	p := model.Project{
		WorkspaceID: input.WorkspaceID,
		Name:        name,
		Description: input.Description,
		LogoURL:     input.LogoURL,
		ColorBadge:  input.ColorBadge,
		Visibility:  input.Visibility,
		CreatedBy:   input.UserID,
	}

	data, err = u.projectRepo.Create(ctx, p, categories)
	if err != nil {
		return data, err
	}
	return data, nil
}
