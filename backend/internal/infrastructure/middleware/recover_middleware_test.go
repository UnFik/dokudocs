package middleware_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/middleware"
)

func TestRecover(t *testing.T) {
	log := logger.New()

	handler := middleware.Recover(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("something went terribly wrong")
	}))

	req := httptest.NewRequest(http.MethodGet, "/panic", nil)
	rec := httptest.NewRecorder()

	// Ensure the panic does not bubble up out of the middleware
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected status %d, got %d", http.StatusInternalServerError, rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("internal server error")) {
		t.Fatalf("expected response body to contain error message, got %s", rec.Body.String())
	}
}
