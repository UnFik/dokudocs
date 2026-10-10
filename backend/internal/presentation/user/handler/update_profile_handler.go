package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/user/dto"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"
	"backend/internal/presentation/user/presenter"

	"github.com/google/uuid"
)

// UpdateProfile updates the profile of current user.
// @Summary Update user profile
// @Description Update profile details of authenticated user
// @Tags User
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param request body presenter.UpdateProfileRequest true "Update profile payload"
// @Success 200 {object} response.Envelope{data=model.UserProfile}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /user/profile [put]
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	u, ok := middleware.UserFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	userID, err := uuid.Parse(u.ID)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, "invalid user id")
		return
	}
	var req presenter.UpdateProfileRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid json body")
		return
	}
	profile, err := h.service.UpdateProfile(r.Context(), dto.UpdateProfileInput{
		UserID:      userID,
		FullName:    req.FullName,
		PhoneNumber: req.PhoneNumber,
		Bio:         req.Bio,
		AvatarURL:   req.AvatarURL,
	})
	if errors.Is(err, constant.ErrInvalidDisplayName) {
		response.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "failed to update profile")
		return
	}
	_ = response.Data(w, http.StatusOK, profile)
}
