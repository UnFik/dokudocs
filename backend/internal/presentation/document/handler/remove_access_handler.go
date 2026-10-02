package handler

import (
	"net/http"

	"backend/internal/presentation/response"
)

// RemoveAccess revokes document access from a user.
// @Summary Revoke document access
// @Description Remove collaborator access from a document
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID (UUID)"
// @Param accessId path string true "Collaborator User ID (UUID)"
// @Success 200 {object} response.Envelope{data=map[string]string}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents/{id}/accesses/{accessId} [delete]
func (h *Handler) RemoveAccess(w http.ResponseWriter, r *http.Request) {
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
	targetUserID, err := parsePathUUID(r, "accessId")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid target user ID")
		return
	}
	if err := h.service.RemoveAccess(r.Context(), id, wsID, targetUserID, userID); err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "access revoked"})
}
