package usecase

import (
	"context"

	"backend/internal/application/project/dto"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type ProjectUseCase interface {
	ListProjects(ctx context.Context, workspaceID, userID uuid.UUID) (data []model.Project, err error)
	GetProject(ctx context.Context, id, workspaceID, userID uuid.UUID) (data model.Project, err error)
	CreateProject(ctx context.Context, input dto.CreateProjectInput) (data model.Project, err error)
	UpdateProject(ctx context.Context, input dto.UpdateProjectInput) (data model.Project, err error)
	DeleteProject(ctx context.Context, id, workspaceID, userID uuid.UUID) (err error)
	ToggleStar(ctx context.Context, id, workspaceID, userID uuid.UUID) (data bool, err error)

	// Categories
	ListCategories(ctx context.Context, projectID, workspaceID, userID uuid.UUID) (data []model.ProjectCategory, err error)
	AddCategory(ctx context.Context, projectID, workspaceID, userID uuid.UUID, name, colorID string) (data model.ProjectCategory, err error)
	UpdateCategory(ctx context.Context, projectID, categoryID, workspaceID, userID uuid.UUID, name, colorID string) (err error)
	DeleteCategory(ctx context.Context, projectID, categoryID, workspaceID, userID uuid.UUID) (err error)
	ReorderCategories(ctx context.Context, projectID, workspaceID, userID uuid.UUID, categoryIDs []uuid.UUID) (err error)

	// Members
	ListMembers(ctx context.Context, projectID, workspaceID, userID uuid.UUID) (data []model.ProjectMember, err error)
	AddOrUpdateMember(ctx context.Context, projectID, workspaceID, actorID uuid.UUID, email, role string) (err error)
	RemoveMember(ctx context.Context, projectID, workspaceID, memberUserID, actorID uuid.UUID) (err error)
}
