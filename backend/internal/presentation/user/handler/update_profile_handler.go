package handler

import (
	"net/http"

	"backend/internal/application/user/dto"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"
	"backend/internal/presentation/user/presenter"

	"github.com/google/uuid"
)

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
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "failed to update profile")
		return
	}
	_ = response.Data(w, http.StatusOK, profile)
}
