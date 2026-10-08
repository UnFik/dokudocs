// Package handler holds the endpoints the collaboration service calls. They are
// not for browsers: every request carries a shared secret.
package handler

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	appauth "backend/internal/application/auth/dto"
	"backend/internal/application/collaboration"

	"github.com/google/uuid"
)

const secretHeader = "X-Collab-Secret"

// maxStateBytes bounds one stored state. Larger documents are refused instead of
// filling the database.
const maxStateBytes = 64 << 20

type TokenVerifier interface {
	VerifyToken(string) (appauth.ResponseUser, error)
}

type AccessReader interface {
	ReadRoomHead(ctx context.Context, workspaceID, documentID uuid.UUID, userIDs []uuid.UUID) (collaboration.RoomHead, error)
}

// ErrDocumentNotFound means the document does not exist in that workspace.
var ErrDocumentNotFound = collaboration.ErrCollabDocumentNotFound

// StateStore keeps the Yjs state of a document and the JSON derived from it.
type StateStore interface {
	// LoadDocument returns the state and the JSON content; either may be nil. A
	// document made from JSON alone has no state yet, and the service builds one.
	LoadDocument(ctx context.Context, workspaceID, documentID uuid.UUID) ([]byte, json.RawMessage, error)
	// markdown is the same document as text, kept for previews, search and exports.
	StoreState(ctx context.Context, workspaceID, documentID uuid.UUID, state []byte, content json.RawMessage, markdown string, suggestions []collaboration.Suggestion, options ...collaboration.StoreOption) error
}

type InternalHandler struct {
	verifier TokenVerifier
	access   AccessReader
	store    StateStore
	secret   string
}

func NewInternalHandler(verifier TokenVerifier, access AccessReader, store StateStore, secret string) *InternalHandler {
	return &InternalHandler{verifier: verifier, access: access, store: store, secret: secret}
}

func (h *InternalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.secret == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get(secretHeader)), []byte(h.secret)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/internal/collab/authorize":
		h.authorize(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/internal/collab/document":
		h.loadDocument(w, r)
	case r.Method == http.MethodPut && r.URL.Path == "/internal/collab/document":
		h.storeState(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (h *InternalHandler) authorize(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Token       string `json:"token"`
		WorkspaceID string `json:"workspaceID"`
		DocumentID  string `json:"documentID"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&request); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	workspaceID, err1 := uuid.Parse(request.WorkspaceID)
	documentID, err2 := uuid.Parse(request.DocumentID)
	if err1 != nil || err2 != nil {
		http.Error(w, "invalid ids", http.StatusBadRequest)
		return
	}
	// 401 is for a wrong service secret; a token that is not valid is 403.
	user, err := h.verifier.VerifyToken(request.Token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusForbidden)
		return
	}
	userID, err := uuid.Parse(user.ID)
	if err != nil {
		http.Error(w, "invalid token", http.StatusForbidden)
		return
	}
	head, err := h.access.ReadRoomHead(r.Context(), workspaceID, documentID, []uuid.UUID{userID})
	if err != nil {
		http.Error(w, "access lookup failed", http.StatusServiceUnavailable)
		return
	}
	access := head.Access[userID] // the zero value, no access, for someone outside the workspace
	writeJSON(w, http.StatusOK, map[string]any{
		"userID":     userID.String(),
		"canRead":    access.CanRead,
		"canEdit":    access.CanEdit,
		"canSuggest": access.CanSuggest,
		// The service picks how to read and store the room by this.
		"documentType": head.DocumentType,
	})
}

func ids(r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	workspaceID, err1 := uuid.Parse(r.URL.Query().Get("workspaceID"))
	documentID, err2 := uuid.Parse(r.URL.Query().Get("documentID"))
	return workspaceID, documentID, err1 == nil && err2 == nil
}

func (h *InternalHandler) loadDocument(w http.ResponseWriter, r *http.Request) {
	workspaceID, documentID, ok := ids(r)
	if !ok {
		http.Error(w, "invalid ids", http.StatusBadRequest)
		return
	}
	state, content, err := h.store.LoadDocument(r.Context(), workspaceID, documentID)
	if errors.Is(err, ErrDocumentNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "load failed", http.StatusServiceUnavailable)
		return
	}
	response := map[string]any{"state": nil, "content": nil}
	if len(state) > 0 {
		response["state"] = base64.StdEncoding.EncodeToString(state)
	}
	if len(content) > 0 {
		response["content"] = content
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *InternalHandler) storeState(w http.ResponseWriter, r *http.Request) {
	workspaceID, documentID, ok := ids(r)
	if !ok {
		http.Error(w, "invalid ids", http.StatusBadRequest)
		return
	}
	var request struct {
		State       string          `json:"state"`
		Content     json.RawMessage `json:"content"`
		Markdown    string          `json:"markdown"`
		UpdatedBy   string          `json:"updatedBy"`
		Suggestions []struct {
			ID     string `json:"id"`
			Author string `json:"author"`
		} `json:"suggestions"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, maxStateBytes*2)).Decode(&request); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	state, err := base64.StdEncoding.DecodeString(request.State)
	if err != nil || len(state) == 0 || len(state) > maxStateBytes {
		http.Error(w, "invalid state", http.StatusBadRequest)
		return
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(request.Content, &object); err != nil || object == nil {
		http.Error(w, "content must be a JSON object", http.StatusBadRequest)
		return
	}
	suggestions := make([]collaboration.Suggestion, 0, len(request.Suggestions))
	for _, item := range request.Suggestions {
		id, err1 := uuid.Parse(item.ID)
		author, err2 := uuid.Parse(item.Author)
		if err1 == nil && err2 == nil {
			suggestions = append(suggestions, collaboration.Suggestion{ID: id, Author: author})
		}
	}
	var options []collaboration.StoreOption
	if editor, err := uuid.Parse(request.UpdatedBy); err == nil {
		options = append(options, collaboration.WithUpdatedBy(editor))
	}
	if err := h.store.StoreState(r.Context(), workspaceID, documentID, state, request.Content, request.Markdown, suggestions, options...); err != nil {
		if errors.Is(err, ErrDocumentNotFound) {
			http.NotFound(w, r)
			return
		}
		http.Error(w, "store failed", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
