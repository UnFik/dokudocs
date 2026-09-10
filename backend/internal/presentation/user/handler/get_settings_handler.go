package handler

import (
	"net/http"

	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

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
