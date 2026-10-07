package collabclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestReloadRoomAsksTheServiceToCloseTheRoom(t *testing.T) {
	workspaceID, documentID := uuid.New(), uuid.New()
	var gotMethod, gotPath, gotRoom, gotSecret string
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotRoom, gotSecret = r.Method, r.URL.Path, r.URL.Query().Get("room"), r.Header.Get("X-Collab-Secret")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer service.Close()

	if err := New(service.URL, "shared").ReloadRoom(context.Background(), workspaceID, documentID); err != nil {
		t.Fatalf("ReloadRoom() = %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/internal/reload" || gotRoom != workspaceID.String()+"."+documentID.String() || gotSecret != "shared" {
		t.Fatalf("request = %s %s room=%q secret=%q", gotMethod, gotPath, gotRoom, gotSecret)
	}
}

func TestReloadRoomReportsARefusal(t *testing.T) {
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer service.Close()
	if err := New(service.URL, "wrong").ReloadRoom(context.Background(), uuid.New(), uuid.New()); err == nil {
		t.Fatal("ReloadRoom() with a refused secret succeeded, want an error")
	}
}

func TestReloadRoomDoesNothingWithoutAServiceURL(t *testing.T) {
	if err := New("", "shared").ReloadRoom(context.Background(), uuid.New(), uuid.New()); err != nil {
		t.Fatalf("ReloadRoom() with no URL = %v, want nil", err)
	}
}
