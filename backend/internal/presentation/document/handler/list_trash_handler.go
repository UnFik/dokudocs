package handler

import (
	"net/http"

	"backend/internal/presentation/response"
)

func (h *Handler) ListTrash(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	trash, err := h.service.ListTrash(r.Context(), wsID, userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, trash)
}
