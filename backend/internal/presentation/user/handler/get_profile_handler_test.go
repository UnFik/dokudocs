package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/application/auth/dto"
	userdto "backend/internal/application/user/dto"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/validator"
	"backend/internal/presentation/middleware"
	handler "backend/internal/presentation/user/handler"

	"github.com/google/uuid"
)

type mockUserUseCase struct {
	profile  model.UserProfile
	settings model.UserSettings
	users    []model.UserSummary
}

func (m *mockUserUseCase) GetProfile(ctx context.Context, userID uuid.UUID) (model.UserProfile, error) {
	return m.profile, nil
}
func (m *mockUserUseCase) UpdateProfile(ctx context.Context, input userdto.UpdateProfileInput) (model.UserProfile, error) {
	m.profile.FullName = input.FullName
	return m.profile, nil
}
func (m *mockUserUseCase) GetSettings(ctx context.Context, userID uuid.UUID) (model.UserSettings, error) {
	return m.settings, nil
}
func (m *mockUserUseCase) UpdateSettings(ctx context.Context, settings model.UserSettings) (model.UserSettings, error) {
	m.settings = settings
	return m.settings, nil
}
func (m *mockUserUseCase) SearchUsers(ctx context.Context, query string, limit int) ([]model.UserSummary, error) {
	return m.users, nil
}

func TestGetProfileHandler(t *testing.T) {
	uid := uuid.New()
	mock := &mockUserUseCase{
		profile: model.UserProfile{ID: uid, Email: "user@example.com", FullName: "User Test"},
	}
	h := handler.NewHandler(mock, validator.New())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me/profile", nil)
	req = req.WithContext(middleware.ContextWithUser(req.Context(), dto.ResponseUser{ID: uid.String(), Email: "user@example.com"}))

	h.GetProfile(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), "User Test") {
		t.Fatalf("body missing User Test: %s", rec.Body.String())
	}
}
