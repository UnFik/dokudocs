package handler

import (
	"net/http"
	"strconv"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
)

// SearchUsers searches users by query string.
// @Summary Search users
// @Description Search users by email or name query
// @Tags User
// @Produce json
// @Security BearerAuth
// @Param q query string false "Search query string"
// @Param limit query int false "Max results count" default(10)
// @Success 200 {object} response.Envelope{data=[]model.UserSummary}
// @Failure 500 {object} response.ErrorEnvelope
// @Router /user/search [get]
func (h *Handler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit := 10
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	users, err := h.service.SearchUsers(r.Context(), q, limit)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "failed to search users")
		return
	}
	_ = response.Data(w, http.StatusOK, users)
}
