package handler

import (
	"net/http"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// GetSettings retrieves user settings for the authenticated user.
// @Summary Get user settings
// @Description Retrieve settings for authenticated user
// @Tags User
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope{data=model.UserSettings}
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Router /user/settings [get]
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
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
	settings, err := h.service.GetSettings(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "settings not found")
		return
	}
	_ = response.Data(w, http.StatusOK, settings)
}
