package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	jwtmanager "backend/internal/application/jwt"
	"backend/internal/config"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

const gateSecret = "test-secret-key-that-is-at-least-32-bytes-long"

func tokenFor(t *testing.T, verified bool) string {
	t.Helper()
	issued, err := jwtmanager.NewManager(gateSecret, time.Hour).Issue(model.AuthUser{
		ID: uuid.New(), AccountNo: "ACC1", Email: "a@example.com", Roles: []string{"member"}, EmailVerified: verified,
	})
	if err != nil {
		t.Fatal(err)
	}
	return issued.AccessToken
}

func get(h http.Handler, path, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestUnverifiedEmailCanOnlyReachAuthMeWhenTheGateIsOn(t *testing.T) {
	h := authRoutes(config.Config{RequireEmailVerification: true})
	token := tokenFor(t, false)

	for _, path := range []string{"/api/v1/users/me/profile", "/api/v1/workspaces", "/api/v1/projects", "/api/v1/documents", "/api/v1/catalog"} {
		rec := get(h, path, token)
		if rec.Code != http.StatusForbidden {
			t.Errorf("GET %s: want 403, got %d", path, rec.Code)
		}
	}
	rec := get(h, "/api/v1/auth/me", token)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /auth/me: want 200 so the client can read its own state, got %d", rec.Code)
	}
}
