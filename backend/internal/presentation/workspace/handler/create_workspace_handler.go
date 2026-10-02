package handler

import (
	"net/http"

	"backend/internal/application/workspace/dto"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
	"backend/internal/presentation/workspace/presenter"
)

// Create creates a new workspace.
// @Summary Create workspace
// @Description Create a new workspace for the authenticated user
// @Tags Workspace
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body presenter.CreateWorkspaceRequest true "Workspace creation payload"
// @Success 201 {object} response.Envelope{data=model.Workspace}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /workspaces [post]
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req presenter.CreateWorkspaceRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" {
		response.Error(w, http.StatusBadRequest, "workspace name is required")
		return
	}
	ws, err := h.service.CreateWorkspace(r.Context(), dto.CreateWorkspaceInput{
		Name:    req.Name,
		Plan:    req.Plan,
		LogoURL: req.LogoURL,
		UserID:  userID,
	})
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusCreated, ws)
}
