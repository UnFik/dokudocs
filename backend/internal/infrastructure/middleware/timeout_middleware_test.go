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
	t.Run("does not wrap a WebSocket upgrade", func(t *testing.T) {
		handler := middleware.Timeout(time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(10 * time.Millisecond)
			w.WriteHeader(http.StatusNoContent)
		}))
		req := httptest.NewRequest(http.MethodGet, "/collaboration/doc", nil)
		req.Header.Set("Connection", "keep-alive, Upgrade")
		req.Header.Set("Upgrade", "websocket")
		rec := httptest.NewRecorder()

		handler.ServeHTTP(rec, req)

		if rec.Code != http.StatusNoContent {
			t.Fatalf("WebSocket upgrade passed through timeout wrapper with status %d", rec.Code)
		}
	})

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

func TestTimeoutWithRAGUsesLongerModelRequestDeadline(t *testing.T) {
	handler := middleware.TimeoutWithRAG(20*time.Millisecond, 100*time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/rag/conversations/id/messages", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("RAG request status = %d, want %d", recorder.Code, http.StatusOK)
	}
}
