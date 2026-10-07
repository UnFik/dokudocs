// Package handler serves the Architecture catalog and requests for missing entries.
package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"

	appcatalog "backend/internal/application/catalog"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type Handler struct{ service *appcatalog.Service }

func New(service *appcatalog.Service) *Handler { return &Handler{service: service} }

// List returns every catalog entry, deprecated ones included: canvases still show them.
// @Summary List the Architecture catalog
// @Tags Catalog
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope
// @Success 304
// @Router /catalog [get]
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	entries, err := h.service.List(r.Context())
	if err != nil {
		response.Error(w, http.StatusServiceUnavailable, "the catalog could not be read; try again")
		return
	}
	raw, _ := json.Marshal(entries)
	sum := sha256.Sum256(raw)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	// The catalog changes only with a release, so the browser keeps it and asks again cheaply.
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"entries": entries})
}

type requestBody struct {
	WorkspaceID string `json:"workspaceID"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Website     string `json:"website"`
	Note        string `json:"note"`
}

// Request asks for an entry the catalog does not have, or adds a vote to the same request.
// @Summary Request a catalog entry
// @Tags Catalog
// @Accept json
// @Produce json
// @Security BearerAuth
// @Success 201 {object} response.Envelope
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 409 {object} response.Envelope
// @Failure 429 {object} response.ErrorEnvelope
// @Router /catalog/requests [post]
func (h *Handler) Request(w http.ResponseWriter, r *http.Request) {
	u, ok := middleware.UserFromContext(r.Context())
	userID, err := uuid.Parse(u.ID)
	if !ok || err != nil {
		response.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var body requestBody
	if err := response.DecodeJSON(r, &body); err != nil {
		response.Error(w, http.StatusBadRequest, "the request is not valid JSON")
		return
	}
	workspaceID, err := uuid.Parse(body.WorkspaceID)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "workspaceID is required")
		return
	}
	result, err := h.service.Request(r.Context(), appcatalog.RequestInput{
		UserID: userID, WorkspaceID: workspaceID, Name: body.Name, Category: body.Category, Website: body.Website, Note: body.Note,
	})
	var inCatalog appcatalog.InCatalogError
	switch {
	case err == nil:
		_ = response.Data(w, http.StatusCreated, result)
	case errors.As(err, &inCatalog):
		_ = response.Data(w, http.StatusConflict, map[string]string{"slug": inCatalog.Slug, "title": "this is already in the catalog"})
	case errors.Is(err, appcatalog.ErrInvalidRequest):
		response.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, appcatalog.ErrNotMember):
		response.Error(w, http.StatusForbidden, "you are not a member of this workspace")
	case errors.Is(err, appcatalog.ErrTooManyRequests):
		response.Error(w, http.StatusTooManyRequests, "you have 20 open requests; wait until some are answered")
	default:
		response.Error(w, http.StatusServiceUnavailable, "the request could not be saved; try again")
	}
}
