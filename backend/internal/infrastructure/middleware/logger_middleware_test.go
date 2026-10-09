package middleware

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
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
		{path: "/api/v1/public/documents/secret-token", want: "/api/v1/public/documents/[REDACTED]"},
		{path: "/api/v1/public/documents/secret-token/assets/a1", want: "/api/v1/public/documents/[REDACTED]/assets/a1"},
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

func TestLoggerWritesOneJSONLinePerRequest(t *testing.T) {
	var out bytes.Buffer
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/documents/{id}", func(w http.ResponseWriter, r *http.Request) {
		logger.SetUserID(r.Context(), "user-1")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("created"))
	})
	handler := Logger(logger.NewJSON(&out))(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/doc-9?token=secret", nil)
	req.Header.Set("CF-Connecting-IP", "203.0.113.9")
	req.Header.Set("X-Forwarded-For", "198.51.100.1")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated || rec.Body.String() != "created" {
		t.Fatalf("response = %d %q, want 201 \"created\"", rec.Code, rec.Body.String())
	}
	line := onlyLine(t, &out)
	want := map[string]any{
		"level":     "INFO",
		"msg":       "request",
		"method":    "GET",
		"route":     "GET /api/v1/documents/{id}",
		"path":      "/api/v1/documents/doc-9",
		"status":    float64(201),
		"user_id":   "user-1",
		"client_ip": "203.0.113.9",
	}
	for key, value := range want {
		if line[key] != value {
			t.Errorf("%s = %v, want %v", key, line[key], value)
		}
	}
	if _, ok := line["duration_ms"].(float64); !ok {
		t.Errorf("duration_ms = %v, want a number", line["duration_ms"])
	}
	if strings.Contains(out.String(), "secret") {
		t.Errorf("the query string was logged: %s", out.String())
	}
}

func TestLoggerMarksServerErrorsAndHidesShareTokens(t *testing.T) {
	var out bytes.Buffer
	handler := Logger(logger.NewJSON(&out))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	req := httptest.NewRequest(http.MethodGet, "/public/documents/share-token/body", nil)
	req.RemoteAddr = "192.0.2.4:5555"
	handler.ServeHTTP(httptest.NewRecorder(), req)

	line := onlyLine(t, &out)
	if line["level"] != "ERROR" {
		t.Errorf("level = %v, want ERROR", line["level"])
	}
	if line["path"] != "/public/documents/[REDACTED]/body" {
		t.Errorf("path = %v", line["path"])
	}
	if line["client_ip"] != "192.0.2.4" {
		t.Errorf("client_ip = %v, want the peer address", line["client_ip"])
	}
	if _, ok := line["user_id"]; ok {
		t.Errorf("user_id logged for an anonymous request")
	}
}

func onlyLine(t *testing.T, out *bytes.Buffer) map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1: %s", len(lines), out.String())
	}
	var line map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &line); err != nil {
		t.Fatalf("log line is not JSON: %v: %s", err, lines[0])
	}
	return line
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
