package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/config"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"
)

func TestDocsRoutes(t *testing.T) {
	log := logger.New()
	val := validator.New()
	c := container.New(nil, log, val)
	cfg := config.Config{
		JWTSecret: "test-secret-key-that-is-at-least-32-bytes-long",
	}

	handler := InitRoutes(c, cfg)

	t.Run("GET /docs serves Scalar HTML", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/docs", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}
		contentType := rec.Header().Get("Content-Type")
		if !strings.Contains(contentType, "text/html") {
			t.Errorf("expected text/html content type, got %s", contentType)
		}
		body := rec.Body.String()
		if !strings.Contains(body, "api-reference") || !strings.Contains(body, "@scalar/api-reference") {
			t.Errorf("expected Scalar reference in HTML body")
		}
		if !strings.Contains(body, "deepSpace") {
			t.Errorf("expected deepSpace theme configuration")
		}
	})

	t.Run("GET /docs/ serves Scalar HTML", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/docs/", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}
	})

	t.Run("GET /docs/swagger.json serves valid JSON swagger spec", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/docs/swagger.json", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}
		contentType := rec.Header().Get("Content-Type")
		if !strings.Contains(contentType, "application/json") {
			t.Errorf("expected application/json content type, got %s", contentType)
		}
		body := rec.Body.String()
		if !strings.Contains(body, "Dokudocs API") {
			t.Errorf("expected 'Dokudocs API' in swagger spec")
		}
		if !strings.Contains(body, "/workspaces") || !strings.Contains(body, "/documents") {
			t.Errorf("expected paths in swagger spec")
		}
	})

	t.Run("GET /docs/swagger.yaml serves swagger yaml", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/docs/swagger.yaml", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d", rec.Code)
		}
		contentType := rec.Header().Get("Content-Type")
		if !strings.Contains(contentType, "yaml") {
			t.Errorf("expected yaml content type, got %s", contentType)
		}
	})
}
