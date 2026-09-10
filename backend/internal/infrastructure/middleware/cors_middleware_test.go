package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/infrastructure/middleware"
)

func TestCORS(t *testing.T) {
	tests := []struct {
		name           string
		allowedOrigin  string
		requestOrigin  string
		method         string
		expectedStatus int
		expectHeaders  bool
	}{
		{
			name:           "matching origin sets headers",
			allowedOrigin:  "http://example.com",
			requestOrigin:  "http://example.com",
			method:         http.MethodGet,
			expectedStatus: http.StatusOK,
			expectHeaders:  true,
		},
		{
			name:           "wildcard origin sets headers",
			allowedOrigin:  "*",
			requestOrigin:  "http://other.com",
			method:         http.MethodGet,
			expectedStatus: http.StatusOK,
			expectHeaders:  true,
		},
		{
			name:           "empty allowedOrigin allows request origin",
			allowedOrigin:  "",
			requestOrigin:  "http://custom.com",
			method:         http.MethodGet,
			expectedStatus: http.StatusOK,
			expectHeaders:  true,
		},
		{
			name:           "mismatched origin does not set CORS headers",
			allowedOrigin:  "http://allowed.com",
			requestOrigin:  "http://denied.com",
			method:         http.MethodGet,
			expectedStatus: http.StatusOK,
			expectHeaders:  false,
		},
		{
			name:           "options preflight request returns 204 no content",
			allowedOrigin:  "*",
			requestOrigin:  "http://example.com",
			method:         http.MethodOptions,
			expectedStatus: http.StatusNoContent,
			expectHeaders:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := middleware.CORS(tt.allowedOrigin)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte("ok"))
			}))

			req := httptest.NewRequest(tt.method, "/test", nil)
			if tt.requestOrigin != "" {
				req.Header.Set("Origin", tt.requestOrigin)
			}
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != tt.expectedStatus {
				t.Fatalf("expected status %d, got %d", tt.expectedStatus, rec.Code)
			}

			if tt.expectHeaders {
				if got := rec.Header().Get("Access-Control-Allow-Origin"); got != tt.requestOrigin {
					t.Errorf("expected Access-Control-Allow-Origin %q, got %q", tt.requestOrigin, got)
				}
				if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
					t.Error("expected Access-Control-Allow-Methods to be set")
				}
			} else {
				if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
					t.Errorf("expected no Access-Control-Allow-Origin, got %q", got)
				}
			}
		})
	}
}
