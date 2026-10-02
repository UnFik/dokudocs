package handler

import (
	"net/http"

	"backend/internal/application/project/dto"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/project/presenter"
	"backend/internal/presentation/response"
)

// Create creates a new project in the active workspace.
// @Summary Create project
// @Description Create a new project within the active workspace
// @Tags Project
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param request body presenter.CreateProjectRequest true "Project creation payload"
// @Success 201 {object} response.Envelope{data=model.Project}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /projects [post]
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req presenter.CreateProjectRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" {
		response.Error(w, http.StatusBadRequest, "project name is required")
		return
	}
	p, err := h.service.CreateProject(r.Context(), dto.CreateProjectInput{
		WorkspaceID: wsID,
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		LogoURL:     req.LogoURL,
		ColorBadge:  req.ColorBadge,
		Visibility:  req.Visibility,
		Categories:  req.Categories,
	})
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusCreated, p)
}
