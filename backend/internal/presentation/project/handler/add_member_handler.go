package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/project/presenter"
	"backend/internal/presentation/response"
)

// AddMember adds or updates a member's role in a project.
// @Summary Add or update project member
// @Description Add a member by email or update role in a project
// @Tags Project
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Project ID (UUID)"
// @Param request body presenter.AddMemberRequest true "Add member payload"
// @Success 201 {object} response.Envelope{data=map[string]string}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /projects/{id}/members [post]
func (h *Handler) AddMember(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.AddMemberRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Email == "" {
		response.Error(w, http.StatusBadRequest, "email is required")
		return
	}
	if err := h.service.AddOrUpdateMember(r.Context(), id, wsID, userID, req.Email, req.Role); err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrProjectNotFound):
			response.Error(w, http.StatusNotFound, "project not found")
		case errors.Is(err, constant.ErrUserNotFound):
			response.Error(w, http.StatusNotFound, "user not found")
		default:
			response.Error(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusCreated, map[string]string{"status": "member updated"})
}
