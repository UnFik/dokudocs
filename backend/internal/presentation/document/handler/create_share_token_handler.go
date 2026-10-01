package handler

import (
	"net/http"

	"backend/internal/presentation/response"
)

// CreateShareToken generates a share token for public sharing.
// @Summary Create share token
// @Description Generate a public share token for a document
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID (UUID)"
// @Success 200 {object} response.Envelope{data=map[string]string}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents/{id}/share-token [post]
func (h *Handler) CreateShareToken(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	id, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	token, err := h.service.CreateShareToken(r.Context(), id, wsID, userID)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"shareToken": token})
}
