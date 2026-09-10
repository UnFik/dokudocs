package handler

import (
	"net/http"

	"backend/internal/presentation/response"
)

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	list, err := h.service.ListWorkspaces(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, list)
}
