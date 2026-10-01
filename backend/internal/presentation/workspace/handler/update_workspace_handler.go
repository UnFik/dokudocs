package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/workspace/dto"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
	"backend/internal/presentation/workspace/presenter"

	"github.com/google/uuid"
)

// Update updates an existing workspace.
// @Summary Update workspace
// @Description Update workspace details (name, plan, logo)
// @Tags Workspace
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Param request body presenter.UpdateWorkspaceRequest true "Workspace update payload"
// @Success 200 {object} response.Envelope{data=model.Workspace}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /workspaces/{id} [put]
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.UpdateWorkspaceRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	ws, err := h.service.UpdateWorkspace(r.Context(), dto.UpdateWorkspaceInput{
		ID:      wsID,
		Name:    req.Name,
		Plan:    req.Plan,
		LogoURL: req.LogoURL,
		UserID:  userID,
	})
	if err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: admin or owner role required")
		case errors.Is(err, constant.ErrWorkspaceNotFound):
			response.Error(w, http.StatusNotFound, "workspace not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusOK, ws)
}
