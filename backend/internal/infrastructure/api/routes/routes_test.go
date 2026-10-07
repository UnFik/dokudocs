package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/config"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"
)

func TestInitRoutes(t *testing.T) {
	log := logger.New()
	val := validator.New()
	c := container.New(nil, log, val)
	cfg := config.Config{
		JWTSecret: "test-secret-key-that-is-at-least-32-bytes-long",
	}

	handler := InitRoutes(c, cfg)

	tests := []struct {
		name           string
		method         string
		path           string
		expectedStatus int
	}{
		{
			name:           "Health Check",
			method:         http.MethodGet,
			path:           "/api/v1/health",
			expectedStatus: http.StatusOK,
		},
		{
			name:           "Auth Login validation failure without token required",
			method:         http.MethodPost,
			path:           "/api/v1/auth/login",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Auth Register validation failure without token required",
			method:         http.MethodPost,
			path:           "/api/v1/auth/register",
			expectedStatus: http.StatusBadRequest,
		},
		{
			name:           "Protected Auth Me requires auth",
			method:         http.MethodGet,
			path:           "/api/v1/auth/me",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Protected User profile requires auth",
			method:         http.MethodGet,
			path:           "/api/v1/users/me/profile",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Protected User search requires auth",
			method:         http.MethodGet,
			path:           "/api/v1/users",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Protected Workspaces requires auth",
			method:         http.MethodGet,
			path:           "/api/v1/workspaces",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Protected Projects requires auth",
			method:         http.MethodGet,
			path:           "/api/v1/projects",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Protected Documents requires auth",
			method:         http.MethodGet,
			path:           "/api/v1/documents",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "The old document body endpoints are gone",
			method:         http.MethodGet,
			path:           "/api/v1/documents/10000000-0000-4000-8000-000000000001/body",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "The old WebSocket collaboration route is gone",
			method:         http.MethodGet,
			path:           "/api/v1/collaboration/10000000-0000-4000-8000-000000000001",
			expectedStatus: http.StatusNotFound,
		},
		{
			name:           "Protected Trash requires auth",
			method:         http.MethodGet,
			path:           "/api/v1/trash",
			expectedStatus: http.StatusUnauthorized,
		},
		{
			name:           "Nonexistent route returns 404",
			method:         http.MethodGet,
			path:           "/api/v1/non-existent-route",
			expectedStatus: http.StatusNotFound,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.expectedStatus {
				t.Errorf("expected status %d for %s %s, got %d", tc.expectedStatus, tc.method, tc.path, rec.Code)
			}
		})
	}
}
