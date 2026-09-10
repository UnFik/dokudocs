package usecase_test

import (
	"context"
	"testing"

	"backend/internal/application/workspace/dto"
	"backend/internal/application/workspace/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func TestWorkspaceCRUD(t *testing.T) {
	userID := uuid.New()
	wsRepo := &mockWorkspaceRepo{
		roles:   make(map[string]string),
		members: make(map[uuid.UUID][]model.WorkspaceMember),
	}
	userRepo := &mockUserRepo{}
	uc := usecase.NewUseCaseWithRepos(wsRepo, userRepo)

	// Create
	ws, err := uc.CreateWorkspace(context.Background(), dto.CreateWorkspaceInput{
		Name:    "My Workspace",
		Plan:    "Pro",
		LogoURL: "",
		UserID:  userID,
	})
	if err != nil {
		t.Fatalf("CreateWorkspace failed: %v", err)
	}
	if ws.Name != "My Workspace" {
		t.Fatalf("expected name My Workspace, got %s", ws.Name)
	}

	// List
	list, err := uc.ListWorkspaces(context.Background(), userID)
	if err != nil || len(list) != 1 {
		t.Fatalf("expected 1 workspace, got %d", len(list))
	}

	// Add member
	if err := uc.AddMember(context.Background(), dto.AddMemberInput{
		WorkspaceID: ws.ID,
		Email:       "collab@example.com",
		Role:        "editor",
		ActorID:     userID,
	}); err != nil {
		t.Fatalf("AddMember failed: %v", err)
	}
}
