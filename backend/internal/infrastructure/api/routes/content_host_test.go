package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTheContentOriginAnswersThePageRouteAndNothingElse(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	guard := contentHostGuard("usercontent.example.com", ok)
	cases := []struct {
		name, host, path string
		want             int
	}{
		{"page on the content host", "usercontent.example.com", "/content/p/abc", http.StatusOK},
		{"api on the content host", "usercontent.example.com", "/api/v1/documents", http.StatusNotFound},
		{"health on the content host", "usercontent.example.com", "/api/v1/health", http.StatusNotFound},
		{"root on the content host", "usercontent.example.com", "/", http.StatusNotFound},
		{"page on the application host", "app.example.com", "/content/p/abc", http.StatusNotFound},
		{"api on the application host", "app.example.com", "/api/v1/documents", http.StatusOK},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, c.path, nil)
		req.Host = c.host
		rec := httptest.NewRecorder()
		guard.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("%s: %d, want %d", c.name, rec.Code, c.want)
		}
	}
}

func TestWithoutAContentOriginThePageRouteIsClosed(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	guard := contentHostGuard("", ok)
	req := httptest.NewRequest(http.MethodGet, "/content/p/abc", nil)
	rec := httptest.NewRecorder()
	guard.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("page route with no content origin = %d, want 404", rec.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	rec = httptest.NewRecorder()
	guard.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("api with no content origin = %d, want 200", rec.Code)
	}
}
