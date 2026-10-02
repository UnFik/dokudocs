package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// RemoveMember removes a member from a workspace.
// @Summary Remove workspace member
// @Description Remove a member from the workspace
// @Tags Workspace
// @Produce json
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Param userId path string true "Member User ID (UUID)"
// @Success 200 {object} response.Envelope{data=map[string]string}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /workspaces/{id}/members/{userId} [delete]
func (h *Handler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	actorID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	idStr := r.PathValue("id")
	wsID, err := uuid.Parse(idStr)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid workspace ID")
		return
	}
	targetUserIDStr := r.PathValue("userId")
	targetUserID, err := uuid.Parse(targetUserIDStr)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid target user ID")
		return
	}
	if err := h.service.RemoveMember(r.Context(), wsID, targetUserID, actorID); err != nil {
		if errors.Is(err, constant.ErrForbidden) {
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "member removed"})
}
