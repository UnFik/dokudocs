package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"backend/internal/application/auth/dto"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/push/handler"

	"github.com/google/uuid"
)

var user = uuid.MustParse("22222222-2222-4222-8222-222222222222")

type fakeStore struct {
	saved   []string
	removed []string
	agent   string
	err     error
}

func (f *fakeStore) Save(_ context.Context, id uuid.UUID, token, userAgent string) error {
	if id != user {
		return http.ErrNoCookie
	}
	f.saved, f.agent = append(f.saved, token), userAgent
	return f.err
}

func (f *fakeStore) Remove(_ context.Context, id uuid.UUID, token string) error {
	f.removed = append(f.removed, token)
	return f.err
}

func call(h http.HandlerFunc, method string, body any, signedIn bool) *httptest.ResponseRecorder {
	var raw []byte
	switch value := body.(type) {
	case nil:
	case string:
		raw = []byte(value)
	default:
		raw, _ = json.Marshal(value)
	}
	req := httptest.NewRequest(method, "/api/v1/users/me/push-tokens", bytes.NewReader(raw))
	req.Header.Set("User-Agent", "Firefox/200")
	if signedIn {
		req = req.WithContext(middleware.ContextWithUser(req.Context(), dto.ResponseUser{ID: user.String()}))
	}
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func TestConfigIsOffUntilFirebaseIsSetUp(t *testing.T) {
	h := handler.New(&fakeStore{}, nil)
	rec := call(h.Config, http.MethodGet, nil, true)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"data":{"enabled":false}}` {
		t.Fatalf("config without Firebase = %d %s", rec.Code, rec.Body.String())
	}
}

func TestConfigGivesTheBrowserWhatItNeeds(t *testing.T) {
	h := handler.New(&fakeStore{}, &handler.WebConfig{APIKey: "key", AppID: "app", SenderID: "123", ProjectID: "dokudocs", VAPIDKey: "vapid"})
	rec := call(h.Config, http.MethodGet, nil, true)
	var got struct {
		Data struct {
			Enabled  bool   `json:"enabled"`
			VAPIDKey string `json:"vapidKey"`
			Firebase struct {
				APIKey            string `json:"apiKey"`
				ProjectID         string `json:"projectId"`
				AppID             string `json:"appId"`
				MessagingSenderID string `json:"messagingSenderId"`
			} `json:"firebase"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Data.Enabled || got.Data.VAPIDKey != "vapid" || got.Data.Firebase.APIKey != "key" ||
		got.Data.Firebase.ProjectID != "dokudocs" || got.Data.Firebase.AppID != "app" || got.Data.Firebase.MessagingSenderID != "123" {
		t.Fatalf("config = %s", rec.Body.String())
	}
	if rec := call(h.Config, http.MethodGet, nil, false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("config signed out = %d, want 401", rec.Code)
	}
}

func TestRegisteringAndRemovingABrowser(t *testing.T) {
	store := &fakeStore{}
	h := handler.New(store, &handler.WebConfig{})
	if rec := call(h.Register, http.MethodPost, map[string]string{"token": "abc123"}, true); rec.Code != http.StatusNoContent {
		t.Fatalf("register = %d %s", rec.Code, rec.Body.String())
	}
	if len(store.saved) != 1 || store.saved[0] != "abc123" || store.agent != "Firefox/200" {
		t.Fatalf("saved %v for %q, want the token with the browser's name", store.saved, store.agent)
	}
	if rec := call(h.Unregister, http.MethodDelete, map[string]string{"token": "abc123"}, true); rec.Code != http.StatusNoContent || len(store.removed) != 1 {
		t.Fatalf("unregister = %d, removed %v", rec.Code, store.removed)
	}
}

func TestRegisteringRefusesWhatIsNotAToken(t *testing.T) {
	store := &fakeStore{}
	h := handler.New(store, &handler.WebConfig{})
	for name, body := range map[string]any{
		"empty":       map[string]string{"token": ""},
		"blanks":      map[string]string{"token": "   "},
		"with spaces": map[string]string{"token": "a b"},
		"too long":    map[string]string{"token": strings.Repeat("a", 4097)},
		"not json":    "{",
	} {
		if rec := call(h.Register, http.MethodPost, body, true); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: register = %d, want 400", name, rec.Code)
		}
	}
	if len(store.saved) != 0 {
		t.Fatalf("saved %v, want nothing", store.saved)
	}
	if rec := call(h.Register, http.MethodPost, map[string]string{"token": "abc"}, false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("register signed out = %d, want 401", rec.Code)
	}
}
