package handler

import (
	"net/http"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
)

// ListTrash retrieves all items currently in the trash.
// @Summary List trash items
// @Description Get list of soft-deleted documents in the workspace trash
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Success 200 {object} response.Envelope{data=[]model.TrashItem}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /trash [get]
func (h *Handler) ListTrash(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	trash, err := h.service.ListTrash(r.Context(), wsID, userID)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, trash)
}
