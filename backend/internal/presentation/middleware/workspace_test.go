package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/constant"
	"backend/internal/application/auth/dto"
	workspacedto "backend/internal/application/workspace/dto"
	"backend/internal/domain/model"
	"backend/internal/presentation/middleware"

	"github.com/google/uuid"
)

type mockWorkspaceService struct {
	allowedWS uuid.UUID
}

func (m *mockWorkspaceService) ListWorkspaces(ctx context.Context, userID uuid.UUID) ([]model.Workspace, error) {
	return nil, nil
}
func (m *mockWorkspaceService) GetWorkspace(ctx context.Context, id, userID uuid.UUID) (model.Workspace, error) {
	return model.Workspace{}, nil
}
func (m *mockWorkspaceService) CreateWorkspace(ctx context.Context, input workspacedto.CreateWorkspaceInput) (model.Workspace, error) {
	return model.Workspace{}, nil
}
func (m *mockWorkspaceService) UpdateWorkspace(ctx context.Context, input workspacedto.UpdateWorkspaceInput) (model.Workspace, error) {
	return model.Workspace{}, nil
}
func (m *mockWorkspaceService) DeleteWorkspace(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	return nil
}
func (m *mockWorkspaceService) GetMembers(ctx context.Context, workspaceID, userID uuid.UUID) ([]model.WorkspaceMember, error) {
	return nil, nil
}
func (m *mockWorkspaceService) AddMember(ctx context.Context, input workspacedto.AddMemberInput) error {
	return nil
}
func (m *mockWorkspaceService) RemoveMember(ctx context.Context, workspaceID, memberUserID, actorID uuid.UUID) error {
	return nil
}
func (m *mockWorkspaceService) GetUserRole(ctx context.Context, workspaceID, userID uuid.UUID) (string, error) {
	if workspaceID == m.allowedWS {
		return "owner", nil
	}
	return "", constant.ErrForbidden
}

func TestRequireWorkspaceMiddleware(t *testing.T) {
	wsID := uuid.New()
	userID := uuid.New()
	svc := &mockWorkspaceService{allowedWS: wsID}

	mw := middleware.RequireWorkspace(svc)
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		extractedWS, role, ok := middleware.WorkspaceFromContext(r.Context())
		if !ok || extractedWS != wsID || role != "owner" {
			t.Fatalf("unexpected context values: ws=%v, role=%s, ok=%v", extractedWS, role, ok)
		}
		called = true
		w.WriteHeader(http.StatusOK)
	})

	// Case 1: Valid header
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	req.Header.Set("X-Workspace-Id", wsID.String())
	req = req.WithContext(middleware.ContextWithUser(req.Context(), dto.ResponseUser{ID: userID.String(), Email: "u@example.com"}))

	mw(next).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("status = %d, called = %v", rec.Code, called)
	}

	// Case 2: Missing header
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	req2 = req2.WithContext(middleware.ContextWithUser(req2.Context(), dto.ResponseUser{ID: userID.String(), Email: "u@example.com"}))
	mw(next).ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec2.Code, http.StatusBadRequest)
	}

	// Case 3: Forbidden workspace
	rec3 := httptest.NewRecorder()
	req3 := httptest.NewRequest(http.MethodGet, "/api/v1/test", nil)
	req3.Header.Set("X-Workspace-Id", uuid.New().String())
	req3 = req3.WithContext(middleware.ContextWithUser(req3.Context(), dto.ResponseUser{ID: userID.String(), Email: "u@example.com"}))
	mw(next).ServeHTTP(rec3, req3)
	if rec3.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec3.Code, http.StatusForbidden)
	}
}
