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

func authRoutes(cfg config.Config) http.Handler {
	cfg.JWTSecret = "test-secret-key-that-is-at-least-32-bytes-long"
	return InitRoutes(container.New(nil, logger.New(), validator.New()), cfg)
}

func post(h http.Handler, path, remote string) int {
	req := httptest.NewRequest(http.MethodPost, path, nil)
	req.RemoteAddr = remote
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestLoginAndRegisterShareOneRateLimitPerClient(t *testing.T) {
	h := authRoutes(config.Config{RateLimitCredentialsPerMin: 2})
	if got := post(h, "/api/v1/auth/login", "203.0.113.5:1"); got != http.StatusBadRequest {
		t.Fatalf("first login: want 400 from validation, got %d", got)
	}
	if got := post(h, "/api/v1/auth/register", "203.0.113.5:2"); got != http.StatusBadRequest {
		t.Fatalf("second request: want 400 from validation, got %d", got)
	}
	if got := post(h, "/api/v1/auth/login", "203.0.113.5:3"); got != http.StatusTooManyRequests {
		t.Fatalf("third request: want 429, got %d", got)
	}
	if got := post(h, "/api/v1/auth/login", "198.51.100.9:1"); got != http.StatusBadRequest {
		t.Fatalf("another client is unaffected: want 400, got %d", got)
	}
}

func TestGoogleEndpointsHaveTheirOwnLimits(t *testing.T) {
	h := authRoutes(config.Config{RateLimitGoogleStartPerMin: 1, RateLimitGoogleCallbackPerMin: 1})
	post(h, "/api/v1/auth/google/start", "203.0.113.5:1")
	if got := post(h, "/api/v1/auth/google/start", "203.0.113.5:2"); got != http.StatusTooManyRequests {
		t.Fatalf("second start: want 429, got %d", got)
	}
	if got := post(h, "/api/v1/auth/login", "203.0.113.5:3"); got == http.StatusTooManyRequests {
		t.Fatalf("the start limit must not touch login")
	}
}

func TestZeroLimitTurnsRateLimitingOff(t *testing.T) {
	h := authRoutes(config.Config{})
	for i := 0; i < 50; i++ {
		if got := post(h, "/api/v1/auth/login", "203.0.113.5:1"); got == http.StatusTooManyRequests {
			t.Fatalf("request %d was limited with no limit configured", i+1)
		}
	}
}
