package handler

import (
	"net/http"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
)

// ListAccesses retrieves all direct access entries for a document.
// @Summary List document accesses
// @Description Get list of collaborators and their permissions for a document
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID (UUID)"
// @Success 200 {object} response.Envelope{data=[]model.DocumentAccess}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents/{id}/accesses [get]
func (h *Handler) ListAccesses(w http.ResponseWriter, r *http.Request) {
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
	accesses, err := h.service.ListAccesses(r.Context(), id, wsID, userID)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, accesses)
}
