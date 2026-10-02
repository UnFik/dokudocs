package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// GetMembers retrieves all members of a workspace.
// @Summary Get workspace members
// @Description List members of the specified workspace
// @Tags Workspace
// @Produce json
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Success 200 {object} response.Envelope{data=[]model.WorkspaceMember}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /workspaces/{id}/members [get]
func (h *Handler) GetMembers(w http.ResponseWriter, r *http.Request) {
	userID, err := getUserUUID(r)
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
	members, err := h.service.GetMembers(r.Context(), wsID, userID)
	if err != nil {
		if errors.Is(err, constant.ErrForbidden) {
			response.Error(w, http.StatusForbidden, "not a member of this workspace")
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, members)
}
