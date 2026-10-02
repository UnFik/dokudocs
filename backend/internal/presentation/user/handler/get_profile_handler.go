package handler

import (
	"net/http"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// GetProfile retrieves the profile of current user.
// @Summary Get user profile
// @Description Retrieve current authenticated user profile
// @Tags User
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope{data=model.UserProfile}
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Router /user/profile [get]
func (h *Handler) GetProfile(w http.ResponseWriter, r *http.Request) {
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
	profile, err := h.service.GetProfile(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "profile not found")
		return
	}
	_ = response.Data(w, http.StatusOK, profile)
}
