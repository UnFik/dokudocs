package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	appauth "backend/internal/application/auth/dto"
	"backend/internal/application/collaboration"

	"github.com/google/uuid"
)

const secret = "test-collab-secret"

type fakeVerifier struct{ users map[string]string }

func (f fakeVerifier) VerifyToken(token string) (appauth.ResponseUser, error) {
	id, ok := f.users[token]
	if !ok {
		return appauth.ResponseUser{}, errors.New("invalid token")
	}
	return appauth.ResponseUser{ID: id}, nil
}

type fakeAccess struct {
	access map[uuid.UUID]collaboration.RoomAccess
}

func (f fakeAccess) ReadRoomHead(_ context.Context, _, _ uuid.UUID, ids []uuid.UUID) (collaboration.RoomHead, error) {
	head := collaboration.RoomHead{Access: map[uuid.UUID]collaboration.RoomAccess{}}
	for _, id := range ids {
		if access, ok := f.access[id]; ok {
			head.Access[id] = access
		}
	}
	return head, nil
}

type storedState struct {
	workspaceID, documentID uuid.UUID
	state                   []byte
	content                 json.RawMessage
}

type fakeStore struct {
	states   map[uuid.UUID][]byte
	contents map[uuid.UUID]json.RawMessage
	missing  map[uuid.UUID]bool
	stored   []storedState
}

func (f *fakeStore) LoadDocument(_ context.Context, _, documentID uuid.UUID) ([]byte, json.RawMessage, error) {
	if f.missing[documentID] {
		return nil, nil, ErrDocumentNotFound
	}
	return f.states[documentID], f.contents[documentID], nil
}

func (f *fakeStore) StoreState(_ context.Context, workspaceID, documentID uuid.UUID, state []byte, content json.RawMessage) error {
	f.stored = append(f.stored, storedState{workspaceID, documentID, state, content})
	f.states[documentID] = state
	f.contents[documentID] = content
	return nil
}

var (
	workspaceID = uuid.MustParse("11111111-1111-4111-8111-111111111111")
	documentID  = uuid.MustParse("22222222-2222-4222-8222-222222222222")
	editorID    = uuid.MustParse("33333333-3333-4333-8333-333333333333")
	strangerID  = uuid.MustParse("44444444-4444-4444-8444-444444444444")
)

func newHandler(t *testing.T) (*InternalHandler, *fakeStore) {
	t.Helper()
	store := &fakeStore{states: map[uuid.UUID][]byte{}, contents: map[uuid.UUID]json.RawMessage{}, missing: map[uuid.UUID]bool{}}
	h := NewInternalHandler(
		fakeVerifier{users: map[string]string{"tok-editor": editorID.String(), "tok-stranger": strangerID.String()}},
		fakeAccess{access: map[uuid.UUID]collaboration.RoomAccess{
			editorID: {CanRead: true, CanEdit: true, CanSuggest: true},
		}},
		store,
		secret,
	)
	return h, store
}

func do(h http.Handler, method, target string, body any, withSecret bool) *httptest.ResponseRecorder {
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	request := httptest.NewRequest(method, target, reader)
	if withSecret {
		request.Header.Set("X-Collab-Secret", secret)
	}
	recorder := httptest.NewRecorder()
	h.ServeHTTP(recorder, request)
	return recorder
}

func TestAuthorizeNeedsTheServiceSecret(t *testing.T) {
	h, _ := newHandler(t)
	body := map[string]string{"token": "tok-editor", "workspaceID": workspaceID.String(), "documentID": documentID.String()}

	if got := do(h, http.MethodPost, "/internal/collab/authorize", body, false).Code; got != http.StatusUnauthorized {
		t.Fatalf("without the secret = %d, want 401", got)
	}
}

func TestAuthorizeReturnsWhatTheUserMayDo(t *testing.T) {
	h, _ := newHandler(t)
	ask := func(token string) (int, map[string]any) {
		recorder := do(h, http.MethodPost, "/internal/collab/authorize",
			map[string]string{"token": token, "workspaceID": workspaceID.String(), "documentID": documentID.String()}, true)
		var out map[string]any
		_ = json.Unmarshal(recorder.Body.Bytes(), &out)
		return recorder.Code, out
	}

	code, out := ask("tok-editor")
	if code != http.StatusOK || out["userID"] != editorID.String() || out["canRead"] != true || out["canEdit"] != true || out["canSuggest"] != true {
		t.Fatalf("editor = %d %v, want 200 with full access", code, out)
	}
	code, out = ask("tok-stranger")
	if code != http.StatusOK || out["canRead"] != false || out["canEdit"] != false {
		t.Fatalf("a user with no access = %d %v, want 200 with canRead false", code, out)
	}
	if code, _ = ask("tok-unknown"); code != http.StatusUnauthorized {
		t.Fatalf("an unknown token = %d, want 401", code)
	}
}

func TestDocumentRoundTrip(t *testing.T) {
	h, store := newHandler(t)
	target := "/internal/collab/document?workspaceID=" + workspaceID.String() + "&documentID=" + documentID.String()

	empty := do(h, http.MethodGet, target, nil, true)
	var loaded map[string]any
	_ = json.Unmarshal(empty.Body.Bytes(), &loaded)
	if empty.Code != http.StatusOK || loaded["state"] != nil || loaded["content"] != nil {
		t.Fatalf("load of a document with nothing = %d %v, want 200 with null state and content", empty.Code, loaded)
	}

	state := []byte{1, 2, 3, 250}
	put := do(h, http.MethodPut, target, map[string]any{
		"state":   base64.StdEncoding.EncodeToString(state),
		"content": map[string]any{"type": "doc"},
	}, true)
	if put.Code != http.StatusNoContent {
		t.Fatalf("store = %d %s, want 204", put.Code, put.Body.String())
	}
	if len(store.stored) != 1 || !bytes.Equal(store.stored[0].state, state) || string(store.stored[0].content) != `{"type":"doc"}` {
		t.Fatalf("stored = %+v, want the state and the content", store.stored)
	}

	got := do(h, http.MethodGet, target, nil, true)
	_ = json.Unmarshal(got.Body.Bytes(), &loaded)
	if got.Code != http.StatusOK || loaded["state"] != base64.StdEncoding.EncodeToString(state) {
		t.Fatalf("load = %d %v, want the stored state", got.Code, loaded)
	}
	if content, _ := loaded["content"].(map[string]any); content["type"] != "doc" {
		t.Fatalf("load content = %v, want the stored content", loaded["content"])
	}
}

func TestLoadingADocumentThatIsNotThereIsA404(t *testing.T) {
	h, store := newHandler(t)
	store.missing[documentID] = true
	target := "/internal/collab/document?workspaceID=" + workspaceID.String() + "&documentID=" + documentID.String()
	if got := do(h, http.MethodGet, target, nil, true).Code; got != http.StatusNotFound {
		t.Fatalf("load of a missing document = %d, want 404", got)
	}
}

func TestStoreRefusesWhatIsNotAStateAndContent(t *testing.T) {
	h, store := newHandler(t)
	target := "/internal/collab/document?workspaceID=" + workspaceID.String() + "&documentID=" + documentID.String()

	for name, body := range map[string]any{
		"state is not base64":      map[string]any{"state": "***", "content": map[string]any{}},
		"content is not an object": map[string]any{"state": "AQID", "content": "text"},
		"no state":                 map[string]any{"content": map[string]any{}},
	} {
		if got := do(h, http.MethodPut, target, body, true).Code; got != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400", name, got)
		}
	}
	if len(store.stored) != 0 {
		t.Fatalf("nothing should have been stored, got %+v", store.stored)
	}
	if got := do(h, http.MethodPut, "/internal/collab/document?workspaceID=x&documentID=y", map[string]any{}, true).Code; got != http.StatusBadRequest {
		t.Fatalf("bad ids = %d, want 400", got)
	}
}
