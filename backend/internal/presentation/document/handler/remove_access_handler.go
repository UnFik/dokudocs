package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"
)

func (h *Handler) RemoveAccess(w http.ResponseWriter, r *http.Request) {
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
	targetUserID, err := parsePathUUID(r, "accessId")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid target user ID")
		return
	}
	if err := h.service.RemoveAccess(r.Context(), id, wsID, targetUserID, userID); err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrAccessNotFound):
			response.Error(w, http.StatusNotFound, "access not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "access revoked"})
}
