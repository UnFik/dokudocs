package handler

import (
	"net/http"

	"backend/internal/presentation/response"
)

func (h *Handler) CreateShareToken(w http.ResponseWriter, r *http.Request) {
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
	token, err := h.service.CreateShareToken(r.Context(), id, wsID, userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"shareToken": token})
}
