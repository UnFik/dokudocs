package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/workspace/dto"
	"backend/internal/presentation/response"
	"backend/internal/presentation/workspace/presenter"

	"github.com/google/uuid"
)

// AddMember invites or adds a member to a workspace.
// @Summary Add workspace member
// @Description Add a member by email to the workspace
// @Tags Workspace
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Param request body presenter.AddMemberRequest true "Add member payload"
// @Success 201 {object} response.Envelope{data=map[string]string}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /workspaces/{id}/invites [post]
func (h *Handler) AddMember(w http.ResponseWriter, r *http.Request) {
	actorID, err := getUserUUID(r)
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
	var req presenter.AddMemberRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Email == "" {
		response.Error(w, http.StatusBadRequest, "email is required")
		return
	}
	if err := h.service.AddMember(r.Context(), dto.AddMemberInput{
		WorkspaceID: wsID,
		Email:       req.Email,
		Role:        req.Role,
		ActorID:     actorID,
	}); err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: admin or owner role required")
		case errors.Is(err, constant.ErrUserNotFound):
			response.Error(w, http.StatusNotFound, "user not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusCreated, map[string]string{"status": "member added"})
}
