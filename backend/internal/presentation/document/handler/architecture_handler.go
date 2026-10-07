package handler

import (
	"context"
	"net/http"
	"strings"

	docrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// ArchitectureSource is what the Architecture endpoints read and write: where a
// document is used on canvases, and the versions of a canvas.
type ArchitectureSource interface {
	ArchitectureUses(ctx context.Context, workspaceID, documentID, actorID uuid.UUID) ([]docrepo.ArchitectureUse, error)
	ListArchitectureVersions(ctx context.Context, workspaceID, architectureID, actorID uuid.UUID) ([]docrepo.ArchitectureVersion, error)
	CreateArchitectureVersion(ctx context.Context, workspaceID, architectureID, actorID uuid.UUID, label, description string) (docrepo.ArchitectureVersion, error)
	UpdateArchitectureVersion(ctx context.Context, workspaceID, architectureID, versionID, actorID uuid.UUID, label, description string) error
	DeleteArchitectureVersion(ctx context.Context, workspaceID, architectureID, versionID, actorID uuid.UUID) error
}

type ArchitectureHandler struct{ source ArchitectureSource }

func NewArchitectureHandler(source ArchitectureSource) *ArchitectureHandler {
	return &ArchitectureHandler{source: source}
}

type versionBody struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

func (h *ArchitectureHandler) ids(w http.ResponseWriter, r *http.Request) (userID, workspaceID, documentID uuid.UUID, ok bool) {
	userID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err = parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document id")
		return
	}
	return userID, workspaceID, documentID, true
}

func readVersionBody(w http.ResponseWriter, r *http.Request) (versionBody, bool) {
	var body versionBody
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid json body")
		return body, false
	}
	label := strings.TrimSpace(body.Label)
	if label == "" || len([]rune(label)) > 80 || len([]rune(body.Description)) > 1000 {
		response.Error(w, http.StatusBadRequest, "a version needs a label of 1 to 80 characters; the description holds at most 1000")
		return body, false
	}
	body.Label = label
	return body, true
}

// Uses lists the canvases, and the elements on them, that link to a document.
func (h *ArchitectureHandler) Uses(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := h.ids(w, r)
	if !ok {
		return
	}
	uses, err := h.source.ArchitectureUses(r.Context(), workspaceID, documentID, userID)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, uses)
}

func (h *ArchitectureHandler) ListVersions(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := h.ids(w, r)
	if !ok {
		return
	}
	versions, err := h.source.ListArchitectureVersions(r.Context(), workspaceID, documentID, userID)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, versions)
}

func (h *ArchitectureHandler) CreateVersion(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := h.ids(w, r)
	if !ok {
		return
	}
	body, ok := readVersionBody(w, r)
	if !ok {
		return
	}
	version, err := h.source.CreateArchitectureVersion(r.Context(), workspaceID, documentID, userID, body.Label, body.Description)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusCreated, version)
}

func (h *ArchitectureHandler) UpdateVersion(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := h.ids(w, r)
	if !ok {
		return
	}
	versionID, err := parsePathUUID(r, "versionID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid version id")
		return
	}
	body, ok := readVersionBody(w, r)
	if !ok {
		return
	}
	if err := h.source.UpdateArchitectureVersion(r.Context(), workspaceID, documentID, versionID, userID, body.Label, body.Description); err != nil {
		writeDocumentError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ArchitectureHandler) DeleteVersion(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, documentID, ok := h.ids(w, r)
	if !ok {
		return
	}
	versionID, err := parsePathUUID(r, "versionID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid version id")
		return
	}
	if err := h.source.DeleteArchitectureVersion(r.Context(), workspaceID, documentID, versionID, userID); err != nil {
		writeDocumentError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
