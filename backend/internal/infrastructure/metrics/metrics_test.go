package metrics_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/infrastructure/metrics"
)

func scrape(t *testing.T, m *metrics.Metrics) string {
	t.Helper()
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body, _ := io.ReadAll(rec.Body)
	return string(body)
}

func TestRequestsAreCountedByRoutePatternAndStatus(t *testing.T) {
	m := metrics.New()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/documents/{id}", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	handler := m.Middleware(mux)
	for _, path := range []string{"/api/v1/documents/a", "/api/v1/documents/b", "/no/such/page-123"} {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
	}

	out := scrape(t, m)
	for _, want := range []string{
		`http_requests_total{route="GET /api/v1/documents/{id}",status="201"} 2`,
		`http_requests_total{route="unmatched",status="404"} 1`,
		`http_request_duration_seconds_count{route="GET /api/v1/documents/{id}"} 2`,
		"go_goroutines",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("metrics lack %q", want)
		}
	}
	// A path never becomes a label, so unknown URLs cannot grow the series.
	if strings.Contains(out, "page-123") || strings.Contains(out, "documents/a") {
		t.Errorf("a raw path became a label:\n%s", out)
	}
}
