package repository

import (
	"context"

	"backend/internal/domain/model"
	"github.com/google/uuid"
)

type ProjectRepository interface {
	ListByWorkspace(ctx context.Context, workspaceID, userID uuid.UUID) ([]model.Project, error)
	GetByID(ctx context.Context, id, userID uuid.UUID) (model.Project, error)
	Create(ctx context.Context, p model.Project, defaultCategories []string) (model.Project, error)
	Update(ctx context.Context, p model.Project, actorID uuid.UUID) error
	SoftDelete(ctx context.Context, id, workspaceID, actorID uuid.UUID) error
	ToggleStar(ctx context.Context, projectID, workspaceID, userID uuid.UUID) (bool, error)
	GetUserRole(ctx context.Context, projectID, userID uuid.UUID) (string, error)

	// Categories
	ListCategories(ctx context.Context, projectID, workspaceID, userID uuid.UUID) ([]model.ProjectCategory, error)
	AddCategory(ctx context.Context, cat model.ProjectCategory, workspaceID, actorID uuid.UUID) (model.ProjectCategory, error)
	UpdateCategory(ctx context.Context, projectID, workspaceID, actorID, categoryID uuid.UUID, name, colorID string) error
	DeleteCategory(ctx context.Context, projectID, workspaceID, actorID, categoryID uuid.UUID) error
	ReorderCategories(ctx context.Context, projectID, workspaceID, actorID uuid.UUID, categoryIDs []uuid.UUID) error

	// Members
	ListMembers(ctx context.Context, projectID, workspaceID, userID uuid.UUID) ([]model.ProjectMember, error)
	AddOrUpdateMember(ctx context.Context, projectID, workspaceID, actorID, userID uuid.UUID, role string) error
	RemoveMember(ctx context.Context, projectID, workspaceID, actorID, userID uuid.UUID) error
}
