package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/project/presenter"
	"backend/internal/presentation/response"
)

// AddCategory adds a new category to a project.
// @Summary Add project category
// @Description Add a new category to a project
// @Tags Project
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Project ID (UUID)"
// @Param request body presenter.AddCategoryRequest true "Category creation payload"
// @Success 201 {object} response.Envelope{data=model.ProjectCategory}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /projects/{id}/categories [post]
func (h *Handler) AddCategory(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.AddCategoryRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" {
		response.Error(w, http.StatusBadRequest, "category name is required")
		return
	}
	cat, err := h.service.AddCategory(r.Context(), id, wsID, userID, req.Name, req.ColorID)
	if err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrProjectNotFound):
			response.Error(w, http.StatusNotFound, "project not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusCreated, cat)
}
