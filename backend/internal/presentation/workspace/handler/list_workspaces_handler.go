package handler

import (
	"net/http"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
)

// List retrieves all workspaces of the authenticated user.
// @Summary List workspaces
// @Description Get list of workspaces accessible by current user
// @Tags Workspace
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope{data=[]model.Workspace}
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /workspaces [get]
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	list, err := h.service.ListWorkspaces(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, list)
}
