package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// GetMemberProfile retrieves what a hover card shows of a workspace member.
// @Summary Get member profile
// @Description Name, email, avatar, bio, role and join date of a member, for the other members of the workspace
// @Tags Workspace
// @Produce json
// @Security BearerAuth
// @Param id path string true "Workspace ID (UUID)"
// @Param userId path string true "User ID (UUID)"
// @Success 200 {object} response.Envelope{data=model.MemberProfile}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /workspaces/{id}/members/{userId}/profile [get]
func (h *Handler) GetMemberProfile(w http.ResponseWriter, r *http.Request) {
	actorID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	wsID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid workspace ID")
		return
	}
	userID, err := uuid.Parse(r.PathValue("userId"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	profile, err := h.service.GetMemberProfile(r.Context(), wsID, actorID, userID)
	if err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "not a member of this workspace")
		case errors.Is(err, constant.ErrUserNotFound):
			response.Error(w, http.StatusNotFound, "member not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusOK, profile)
}
