package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"
)

// EmptyTrash permanently deletes all items in the workspace trash.
// @Summary Empty trash
// @Description Permanently remove all items from the workspace trash (admin or owner only)
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Success 200 {object} response.Envelope{data=map[string]string}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /trash [delete]
func (h *Handler) EmptyTrash(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	if err := h.service.EmptyTrash(r.Context(), wsID, userID); err != nil {
		if errors.Is(err, constant.ErrForbidden) {
			response.Error(w, http.StatusForbidden, "forbidden: admin or owner role required")
			return
		}
		response.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "trash emptied"})
}
