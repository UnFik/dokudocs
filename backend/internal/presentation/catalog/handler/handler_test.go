package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"backend/internal/application/auth/dto"
	appcatalog "backend/internal/application/catalog"
	"backend/internal/presentation/catalog/handler"
	"backend/internal/presentation/middleware"

	"github.com/google/uuid"
)

type fakeStore struct {
	entries  []appcatalog.Entry
	known    map[string]string
	added    []appcatalog.RequestInput
	addError error
}

func (f *fakeStore) ListEntries(context.Context) ([]appcatalog.Entry, error) { return f.entries, nil }
func (f *fakeStore) FindEntry(_ context.Context, key string) (string, error) {
	return f.known[key], nil
}
func (f *fakeStore) AddRequest(_ context.Context, in appcatalog.RequestInput, _ string) (appcatalog.RequestResult, error) {
	if f.addError != nil {
		return appcatalog.RequestResult{}, f.addError
	}
	f.added = append(f.added, in)
	return appcatalog.RequestResult{ID: uuid.New(), Name: in.Name, Votes: 1}, nil
}

var user = uuid.New()

func call(h http.HandlerFunc, method, target string, body any, headers map[string]string) *httptest.ResponseRecorder {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, target, bytes.NewReader(raw))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req = req.WithContext(middleware.ContextWithUser(req.Context(), dto.ResponseUser{ID: user.String()}))
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestListingTheCatalogCanBeAnsweredFromTheBrowserCache(t *testing.T) {
	family := "request"
	store := &fakeStore{entries: []appcatalog.Entry{
		{Slug: "golang", Category: "system", Subkind: "language", Name: "Go"},
		{Slug: "rest", Category: "protocol", Subkind: "request", Name: "REST", Family: &family},
	}}
	h := handler.New(appcatalog.NewService(store))

	first := call(h.List, http.MethodGet, "/api/v1/catalog", nil, nil)
	if first.Code != http.StatusOK || first.Header().Get("ETag") == "" || first.Header().Get("Cache-Control") != "private, max-age=3600" {
		t.Fatalf("first = %d %v", first.Code, first.Header())
	}
	var out struct {
		Data struct{ Entries []appcatalog.Entry } `json:"data"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &out); err != nil || len(out.Data.Entries) != 2 || out.Data.Entries[1].Slug != "rest" {
		t.Fatalf("body = %s (%v)", first.Body.String(), err)
	}
	again := call(h.List, http.MethodGet, "/api/v1/catalog", nil, map[string]string{"If-None-Match": first.Header().Get("ETag")})
	if again.Code != http.StatusNotModified || again.Body.Len() != 0 {
		t.Fatalf("with the same ETag = %d %q, want 304 and no body", again.Code, again.Body.String())
	}
	store.entries = store.entries[:1]
	changed := call(h.List, http.MethodGet, "/api/v1/catalog", nil, map[string]string{"If-None-Match": first.Header().Get("ETag")})
	if changed.Code != http.StatusOK {
		t.Fatalf("after the catalog changed = %d, want 200", changed.Code)
	}
}

func TestRequestingAMissingEntry(t *testing.T) {
	workspace := uuid.New()
	body := func(name, category string) map[string]string {
		return map[string]string{"workspaceID": workspace.String(), "name": name, "category": category, "website": "https://example.com"}
	}

	store := &fakeStore{known: map[string]string{"postgresql": "postgresql"}}
	h := handler.New(appcatalog.NewService(store))
	if rec := call(h.Request, http.MethodPost, "/api/v1/catalog/requests", body("Acme Queue", "system"), nil); rec.Code != http.StatusCreated || len(store.added) != 1 || store.added[0].UserID != user {
		t.Fatalf("new request = %d %s", rec.Code, rec.Body.String())
	}
	rec := call(h.Request, http.MethodPost, "/api/v1/catalog/requests", body("Postgre SQL", "system"), nil)
	if rec.Code != http.StatusConflict || !bytes.Contains(rec.Body.Bytes(), []byte(`"slug":"postgresql"`)) {
		t.Fatalf("a name already in the catalog = %d %s, want 409 naming the entry", rec.Code, rec.Body.String())
	}
	for name, b := range map[string]map[string]string{
		"no name":        body("  ", "system"),
		"wrong category": body("X", "planet"),
	} {
		if rec := call(h.Request, http.MethodPost, "/api/v1/catalog/requests", b, nil); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400", name, rec.Code)
		}
	}
	for err, want := range map[error]int{appcatalog.ErrTooManyRequests: http.StatusTooManyRequests, appcatalog.ErrNotMember: http.StatusForbidden} {
		store.addError = err
		if rec := call(h.Request, http.MethodPost, "/api/v1/catalog/requests", body("Other", "host"), nil); rec.Code != want {
			t.Fatalf("%v = %d, want %d", err, rec.Code, want)
		}
	}
}
