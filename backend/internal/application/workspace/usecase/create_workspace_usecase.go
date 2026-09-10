package usecase

import (
	"context"
	"fmt"
	"strings"

	"backend/internal/application/workspace/dto"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) CreateWorkspace(ctx context.Context, input dto.CreateWorkspaceInput) (data model.Workspace, err error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return data, fmt.Errorf("workspace name is required")
	}
	plan := input.Plan
	if plan == "" {
		plan = "Free"
	}
	ws := model.Workspace{
		ID:        uuid.New(),
		Name:      name,
		Slug:      slugify(name),
		Plan:      plan,
		LogoURL:   input.LogoURL,
		CreatedBy: input.UserID,
	}
	data, err = u.workspaceRepo.Create(ctx, ws)
	if err != nil {
		return data, err
	}
	return data, nil
}
