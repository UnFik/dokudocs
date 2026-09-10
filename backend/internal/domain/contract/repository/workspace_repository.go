package repository

import (
	"context"

	"backend/internal/domain/model"
	"github.com/google/uuid"
)

type WorkspaceRepository interface {
	ListByUser(ctx context.Context, userID uuid.UUID) ([]model.Workspace, error)
	GetByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (model.Workspace, error)
	Create(ctx context.Context, ws model.Workspace) (model.Workspace, error)
	Update(ctx context.Context, ws model.Workspace) error
	Delete(ctx context.Context, id uuid.UUID) error
	GetMembers(ctx context.Context, workspaceID uuid.UUID) ([]model.WorkspaceMember, error)
	AddMember(ctx context.Context, workspaceID, userID uuid.UUID, role string) error
	RemoveMember(ctx context.Context, workspaceID, userID uuid.UUID) error
	GetUserRole(ctx context.Context, workspaceID, userID uuid.UUID) (string, error)
}
