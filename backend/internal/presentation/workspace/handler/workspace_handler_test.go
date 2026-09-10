package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/application/auth/dto"
	workspacedto "backend/internal/application/workspace/dto"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/validator"
	"backend/internal/presentation/middleware"
	handler "backend/internal/presentation/workspace/handler"

	"github.com/google/uuid"
)

type mockWorkspaceUseCase struct {
	workspaces []model.Workspace
	members    []model.WorkspaceMember
}

func (m *mockWorkspaceUseCase) ListWorkspaces(ctx context.Context, userID uuid.UUID) ([]model.Workspace, error) {
	return m.workspaces, nil
}
func (m *mockWorkspaceUseCase) GetWorkspace(ctx context.Context, id, userID uuid.UUID) (model.Workspace, error) {
	return m.workspaces[0], nil
}
func (m *mockWorkspaceUseCase) CreateWorkspace(ctx context.Context, input workspacedto.CreateWorkspaceInput) (model.Workspace, error) {
	ws := model.Workspace{ID: uuid.New(), Name: input.Name, Plan: input.Plan, LogoURL: input.LogoURL, Role: "owner"}
	m.workspaces = append(m.workspaces, ws)
	return ws, nil
}
func (m *mockWorkspaceUseCase) UpdateWorkspace(ctx context.Context, input workspacedto.UpdateWorkspaceInput) (model.Workspace, error) {
	return m.workspaces[0], nil
}
func (m *mockWorkspaceUseCase) DeleteWorkspace(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	return nil
}
func (m *mockWorkspaceUseCase) GetMembers(ctx context.Context, workspaceID, userID uuid.UUID) ([]model.WorkspaceMember, error) {
	return m.members, nil
}
func (m *mockWorkspaceUseCase) AddMember(ctx context.Context, input workspacedto.AddMemberInput) error {
	return nil
}
func (m *mockWorkspaceUseCase) RemoveMember(ctx context.Context, workspaceID, memberUserID, actorID uuid.UUID) error {
	return nil
}
func (m *mockWorkspaceUseCase) GetUserRole(ctx context.Context, workspaceID, userID uuid.UUID) (string, error) {
	return "owner", nil
}

func TestWorkspaceListAndCreateHandler(t *testing.T) {
	uid := uuid.New()
	mock := &mockWorkspaceUseCase{
		workspaces: []model.Workspace{
			{ID: uuid.New(), Name: "Workspace 1", Role: "owner"},
		},
	}
	h := handler.NewHandler(mock, validator.New())

	// Test List
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces", nil)
	req = req.WithContext(middleware.ContextWithUser(req.Context(), dto.ResponseUser{ID: uid.String(), Email: "u@example.com"}))
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("List status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), "Workspace 1") {
		t.Fatalf("body missing Workspace 1: %s", rec.Body.String())
	}

	// Test Create
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/workspaces", strings.NewReader(`{"name":"New WS","plan":"Free"}`))
	req2 = req2.WithContext(middleware.ContextWithUser(req2.Context(), dto.ResponseUser{ID: uid.String(), Email: "u@example.com"}))
	h.Create(rec2, req2)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("Create status = %d, want %d", rec2.Code, http.StatusCreated)
	}
	if !strings.Contains(rec2.Body.String(), "New WS") {
		t.Fatalf("body missing New WS: %s", rec2.Body.String())
	}
}
