package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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
	access        map[uuid.UUID]collaboration.RoomAccess
	documentType  string
	replacementID uuid.UUID
}

func (f fakeAccess) ReadRoomHead(_ context.Context, _, _ uuid.UUID, ids []uuid.UUID) (collaboration.RoomHead, error) {
	head := collaboration.RoomHead{Access: map[uuid.UUID]collaboration.RoomAccess{}, DocumentType: f.documentType, ReplacementID: f.replacementID}
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
	markdown                string
	suggestions             []collaboration.Suggestion
	updatedBy               *uuid.UUID
	thumbnail               *string
	replacementID           *uuid.UUID
}

type fakeStore struct {
	states   map[uuid.UUID][]byte
	contents map[uuid.UUID]json.RawMessage
	missing  map[uuid.UUID]bool
	stored   []storedState
	// refuse is returned by StoreState instead of storing.
	refuse error
}

func (f *fakeStore) LoadDocument(_ context.Context, _, documentID uuid.UUID) ([]byte, json.RawMessage, error) {
	if f.missing[documentID] {
		return nil, nil, ErrDocumentNotFound
	}
	return f.states[documentID], f.contents[documentID], nil
}

func (f *fakeStore) StoreState(_ context.Context, workspaceID, documentID uuid.UUID, state []byte, content json.RawMessage, markdown string, suggestions []collaboration.Suggestion, options ...collaboration.StoreOption) error {
	if f.refuse != nil {
		return f.refuse
	}
	applied := collaboration.ApplyStoreOptions(options)
	f.stored = append(f.stored, storedState{workspaceID, documentID, state, content, markdown, suggestions, applied.UpdatedBy, applied.Thumbnail, applied.ReplacementID})
	f.states[documentID] = state
	f.contents[documentID] = content
	return nil
}

var (
	workspaceID  = uuid.MustParse("11111111-1111-4111-8111-111111111111")
	documentID   = uuid.MustParse("22222222-2222-4222-8222-222222222222")
	editorID     = uuid.MustParse("33333333-3333-4333-8333-333333333333")
	suggestionID = uuid.MustParse("55555555-5555-4555-8555-555555555555")
	strangerID   = uuid.MustParse("44444444-4444-4444-8444-444444444444")
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
	// 401 is reserved for a wrong service secret; a token that is not valid is 403.
	if code, _ = ask("tok-unknown"); code != http.StatusForbidden {
		t.Fatalf("an unknown token = %d, want 403", code)
	}
}

func TestAuthorizeTellsTheServiceWhatKindOfDocumentTheRoomHolds(t *testing.T) {
	h := NewInternalHandler(
		fakeVerifier{users: map[string]string{"tok-editor": editorID.String()}},
		fakeAccess{access: map[uuid.UUID]collaboration.RoomAccess{editorID: {CanRead: true, CanEdit: true}}, documentType: "architecture"},
		&fakeStore{},
		secret,
	)
	recorder := do(h, http.MethodPost, "/internal/collab/authorize",
		map[string]string{"token": "tok-editor", "workspaceID": workspaceID.String(), "documentID": documentID.String()}, true)
	var out map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &out)
	if recorder.Code != http.StatusOK || out["documentType"] != "architecture" {
		t.Fatalf("authorize = %d %v, want 200 with documentType architecture", recorder.Code, out)
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
		"state":       base64.StdEncoding.EncodeToString(state),
		"content":     map[string]any{"type": "doc"},
		"markdown":    "hello\n",
		"updatedBy":   editorID.String(),
		"suggestions": []map[string]string{{"id": suggestionID.String(), "author": editorID.String()}, {"id": "nope", "author": "x"}},
	}, true)
	if put.Code != http.StatusNoContent {
		t.Fatalf("store = %d %s, want 204", put.Code, put.Body.String())
	}
	if len(store.stored) != 1 || !bytes.Equal(store.stored[0].state, state) || string(store.stored[0].content) != `{"type":"doc"}` || store.stored[0].markdown != "hello\n" ||
		len(store.stored[0].suggestions) != 1 || store.stored[0].suggestions[0] != (collaboration.Suggestion{ID: suggestionID, Author: editorID}) {
		t.Fatalf("stored = %+v, want the state and the content", store.stored)
	}

	if store.stored[0].updatedBy == nil || *store.stored[0].updatedBy != editorID {
		t.Fatalf("updatedBy = %v, want %s", store.stored[0].updatedBy, editorID)
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

func TestAuthorizeTellsTheServiceWhichRecordTheRoomMustHold(t *testing.T) {
	record := uuid.MustParse("66666666-6666-4666-8666-666666666666")
	h := NewInternalHandler(
		fakeVerifier{users: map[string]string{"tok-editor": editorID.String()}},
		fakeAccess{access: map[uuid.UUID]collaboration.RoomAccess{editorID: {CanRead: true, CanEdit: true}}, documentType: "mermaid", replacementID: record},
		&fakeStore{},
		secret,
	)
	recorder := do(h, http.MethodPost, "/internal/collab/authorize",
		map[string]string{"token": "tok-editor", "workspaceID": workspaceID.String(), "documentID": documentID.String()}, true)
	var out map[string]any
	_ = json.Unmarshal(recorder.Body.Bytes(), &out)
	if recorder.Code != http.StatusOK || out["replacementID"] != record.String() {
		t.Fatalf("authorize = %d %v, want 200 with replacementID %s", recorder.Code, out, record)
	}
}

func TestStoreIsForTheRecordTheRoomWasOpenedOn(t *testing.T) {
	h, store := newHandler(t)
	record := uuid.MustParse("66666666-6666-4666-8666-666666666666")
	target := "/internal/collab/document?workspaceID=" + workspaceID.String() + "&documentID=" + documentID.String()
	body := map[string]any{"state": "AQID", "content": map[string]any{"source": "x"}, "replacementID": record.String()}
	if got := do(h, http.MethodPut, target, body, true).Code; got != http.StatusNoContent {
		t.Fatalf("store = %d, want 204", got)
	}
	if got := store.stored[0].replacementID; got == nil || *got != record {
		t.Fatalf("store replacementID = %v, want %s", got, record)
	}
	// A restore replaced the record since: the room is stale, which sending again will not change.
	store.refuse = collaboration.ErrCollabReplaced
	if got := do(h, http.MethodPut, target, body, true).Code; got != http.StatusConflict {
		t.Fatalf("store for a replaced record = %d, want 409", got)
	}
}

func TestStoreRefusesContentThatDoesNotFitTheDocumentType(t *testing.T) {
	h, store := newHandler(t)
	store.refuse = collaboration.ErrInvalidCollabContent
	target := "/internal/collab/document?workspaceID=" + workspaceID.String() + "&documentID=" + documentID.String()
	// Not a 503: sending the same content again would be refused again.
	got := do(h, http.MethodPut, target, map[string]any{"state": "AQID", "content": map[string]any{"type": "doc"}}, true)
	if got.Code != http.StatusBadRequest {
		t.Fatalf("store of content that does not fit = %d, want 400", got.Code)
	}
}

func TestStoreCarriesTheCardDrawingOfACanvas(t *testing.T) {
	h, store := newHandler(t)
	target := "/internal/collab/document?workspaceID=" + workspaceID.String() + "&documentID=" + documentID.String()
	body := func(thumbnail any) map[string]any {
		b := map[string]any{"state": "AQID", "content": map[string]any{"version": 1}, "markdown": ""}
		if thumbnail != nil {
			b["thumbnail"] = thumbnail
		}
		return b
	}

	for _, sent := range []string{`<svg xmlns="http://www.w3.org/2000/svg"></svg>`, ""} {
		if got := do(h, http.MethodPut, target, body(sent), true); got.Code != http.StatusNoContent {
			t.Fatalf("store with thumbnail %q = %d %s, want 204", sent, got.Code, got.Body.String())
		}
		last := store.stored[len(store.stored)-1]
		if last.thumbnail == nil || *last.thumbnail != sent {
			t.Fatalf("thumbnail = %v, want %q (empty clears it)", last.thumbnail, sent)
		}
	}

	// A Markdown room sends none, and the thumbnail is left as it is.
	if got := do(h, http.MethodPut, target, body(nil), true).Code; got != http.StatusNoContent {
		t.Fatalf("store without thumbnail = %d, want 204", got)
	}
	if last := store.stored[len(store.stored)-1]; last.thumbnail != nil {
		t.Fatalf("thumbnail = %q, want none when the service sends none", *last.thumbnail)
	}
}

func TestStoreRefusesACardDrawingThatIsNotASmallSVG(t *testing.T) {
	h, store := newHandler(t)
	target := "/internal/collab/document?workspaceID=" + workspaceID.String() + "&documentID=" + documentID.String()
	for name, thumbnail := range map[string]string{
		"not an SVG":  `<img src=x onerror=alert(1)>`,
		"over 64 KiB": "<svg>" + strings.Repeat(" ", 64*1024) + "</svg>",
	} {
		got := do(h, http.MethodPut, target, map[string]any{"state": "AQID", "content": map[string]any{}, "thumbnail": thumbnail}, true)
		if got.Code != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400", name, got.Code)
		}
	}
	if len(store.stored) != 0 {
		t.Fatalf("nothing should have been stored, got %d", len(store.stored))
	}
}
