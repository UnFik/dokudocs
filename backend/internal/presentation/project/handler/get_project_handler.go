package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
)

// Get retrieves a project by ID.
// @Summary Get project
// @Description Get details of a project by ID within the active workspace
// @Tags Project
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Project ID (UUID)"
// @Success 200 {object} response.Envelope{data=model.Project}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /projects/{id} [get]
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	id, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid project ID")
		return
	}
	p, err := h.service.GetProject(r.Context(), id, wsID, userID)
	if err != nil {
		if errors.Is(err, constant.ErrProjectNotFound) {
			response.Error(w, http.StatusNotFound, "project not found")
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, p)
}
