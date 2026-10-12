package handler

import (
	"net/http"
	"strconv"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
)

// Search finds documents for the command menu.
// @Summary Search documents
// @Description Find readable documents by title, project name, or body text. An empty query returns recent documents.
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param q query string false "Search text"
// @Param limit query int false "Maximum hits (default 8, max 20)"
// @Success 200 {object} response.Envelope{data=[]model.DocumentSearchHit}
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents/search [get]
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	hits, err := h.service.SearchDocuments(r.Context(), wsID, userID, r.URL.Query().Get("q"), limit)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, hits)
}
