package handler

import (
	"net/http"

	"backend/internal/domain/model"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"
	"backend/internal/presentation/user/presenter"

	"github.com/google/uuid"
)

func (h *Handler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.UpdateSettingsRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid json body")
		return
	}
	settings := model.UserSettings{
		UserID:            userID,
		Theme:             req.Theme,
		FontFamily:        req.FontFamily,
		Direction:         req.Direction,
		Language:          req.Language,
		NotificationPrefs: string(req.NotificationPrefs),
		EditorPrefs:       string(req.EditorPrefs),
	}
	updated, err := h.service.UpdateSettings(r.Context(), settings)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "failed to update settings")
		return
	}
	_ = response.Data(w, http.StatusOK, updated)
}
