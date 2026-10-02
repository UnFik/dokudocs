package middleware

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/infrastructure/logger"
)

func TestRedactPublicShareTokenPath(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{path: "/public/documents/secret-token", want: "/public/documents/[REDACTED]"},
		{path: "/public/documents/secret-token/body", want: "/public/documents/[REDACTED]/body"},
		{path: "/api/v1/documents/secret-token", want: "/api/v1/documents/secret-token"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			if got := redactShareTokenPath(test.path); got != test.want {
				t.Fatalf("redactShareTokenPath(%q) = %q, want %q", test.path, got, test.want)
			}
		})
	}
}

func TestLogger(t *testing.T) {
	log := logger.New()
	handlerCalled := false

	handler := Logger(log)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

type hijackableRecorder struct {
	*httptest.ResponseRecorder
}

func (r hijackableRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	server, client := net.Pipe()
	_ = client.Close()
	return server, bufio.NewReadWriter(bufio.NewReader(server), bufio.NewWriter(server)), nil
}

func TestLoggerPreservesHijacker(t *testing.T) {
	handler := Logger(logger.New())(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hijacker, ok := w.(http.Hijacker)
		if !ok {
			t.Fatal("logger removed http.Hijacker")
		}
		conn, _, err := hijacker.Hijack()
		if err != nil {
			t.Fatalf("Hijack(): %v", err)
		}
		_ = conn.Close()
	}))
	rec := hijackableRecorder{ResponseRecorder: httptest.NewRecorder()}
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/collaboration/doc", nil))
}
