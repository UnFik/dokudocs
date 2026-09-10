package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/middleware"
)

func TestLogger(t *testing.T) {
	log := logger.New()
	handlerCalled := false

	handler := middleware.Logger(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("created"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !handlerCalled {
		t.Fatal("expected downstream handler to be called")
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, rec.Code)
	}
	if body := rec.Body.String(); body != "created" {
		t.Fatalf("expected body 'created', got %q", body)
	}
}
