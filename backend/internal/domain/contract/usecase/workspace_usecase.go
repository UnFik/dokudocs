package usecase

import (
	"context"

	"backend/internal/application/workspace/dto"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type WorkspaceUseCase interface {
	ListWorkspaces(ctx context.Context, userID uuid.UUID) (data []model.Workspace, err error)
	GetWorkspace(ctx context.Context, id uuid.UUID, userID uuid.UUID) (data model.Workspace, err error)
	CreateWorkspace(ctx context.Context, input dto.CreateWorkspaceInput) (data model.Workspace, err error)
	UpdateWorkspace(ctx context.Context, input dto.UpdateWorkspaceInput) (data model.Workspace, err error)
	DeleteWorkspace(ctx context.Context, id uuid.UUID, userID uuid.UUID) (err error)
	GetMembers(ctx context.Context, workspaceID uuid.UUID, userID uuid.UUID) (data []model.WorkspaceMember, err error)
	AddMember(ctx context.Context, input dto.AddMemberInput) (err error)
	RemoveMember(ctx context.Context, workspaceID uuid.UUID, memberUserID uuid.UUID, actorID uuid.UUID) (err error)
	GetUserRole(ctx context.Context, workspaceID, userID uuid.UUID) (data string, err error)
}
