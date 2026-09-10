package handler

import (
	"net/http"
	"strconv"

	"backend/internal/presentation/response"
)

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
