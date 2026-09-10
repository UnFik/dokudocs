package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/project/dto"
	"backend/internal/presentation/project/presenter"
	"backend/internal/presentation/response"
)

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.UpdateProjectRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	p, err := h.service.UpdateProject(r.Context(), dto.UpdateProjectInput{
		ID:          id,
		WorkspaceID: wsID,
		UserID:      userID,
		Name:        req.Name,
		Description: req.Description,
		LogoURL:     req.LogoURL,
		ColorBadge:  req.ColorBadge,
		Visibility:  req.Visibility,
	})
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
	_ = response.Data(w, http.StatusOK, p)
}
