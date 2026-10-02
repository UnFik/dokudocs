package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// Get retrieves workspace by ID.
// @Summary Get workspace
// @Description Get details of a workspace by ID
// @Tags Workspace
// @Produce json
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Success 200 {object} response.Envelope{data=model.Workspace}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /workspaces/{id} [get]
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
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
	ws, err := h.service.GetWorkspace(r.Context(), wsID, userID)
	if err != nil {
		if errors.Is(err, constant.ErrWorkspaceNotFound) {
			response.Error(w, http.StatusNotFound, "workspace not found")
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, ws)
}
