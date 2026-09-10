package middleware_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"backend/internal/infrastructure/middleware"
)

func TestTimeout(t *testing.T) {
	t.Run("completes within timeout", func(t *testing.T) {
		handler := middleware.Timeout(100 * time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("fast response"))
		}))

		req := httptest.NewRequest(http.MethodGet, "/fast", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status %d, got %d", http.StatusOK, rec.Code)
		}
		if body := rec.Body.String(); body != "fast response" {
			t.Fatalf("expected body 'fast response', got %q", body)
		}
	})

	t.Run("times out when exceeding duration", func(t *testing.T) {
		handler := middleware.Timeout(20 * time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(50 * time.Millisecond)
			w.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(w, "slow response")
		}))

		req := httptest.NewRequest(http.MethodGet, "/slow", nil)
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected status %d (503 Service Unavailable), got %d", http.StatusServiceUnavailable, rec.Code)
		}
		if body := rec.Body.String(); body != "request timeout" {
			t.Fatalf("expected body 'request timeout', got %q", body)
		}
	})
}
