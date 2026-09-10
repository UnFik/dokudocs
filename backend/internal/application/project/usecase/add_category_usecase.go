package usecase

import (
	"context"
	"fmt"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (u *useCase) AddCategory(ctx context.Context, projectID, workspaceID, userID uuid.UUID, name, colorID string) (data model.ProjectCategory, err error) {
	if _, err = u.GetProject(ctx, projectID, workspaceID, userID); err != nil {
		return data, err
	}
	canEdit, err := u.canEditProject(ctx, projectID, workspaceID, userID)
	if err != nil || !canEdit {
		return data, constant.ErrForbidden
	}

	name = strings.TrimSpace(name)
	if name == "" {
		return data, fmt.Errorf("category name is required")
	}

	cat := model.ProjectCategory{
		ProjectID: projectID,
		Name:      name,
		ColorID:   colorID,
	}
	data, err = u.projectRepo.AddCategory(ctx, cat)
	if err != nil {
		return data, err
	}
	return data, nil
}
