package handler

import (
	"net/http"

	"backend/internal/application/project/dto"
	"backend/internal/presentation/project/presenter"
	"backend/internal/presentation/response"
)

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
