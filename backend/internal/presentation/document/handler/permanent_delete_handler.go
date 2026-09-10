package handler

import (
	"net/http"

	"backend/internal/presentation/response"
)

func (h *Handler) PermanentDelete(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	id, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	if err := h.service.PermanentDelete(r.Context(), id, wsID, userID); err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "permanently deleted"})
}
