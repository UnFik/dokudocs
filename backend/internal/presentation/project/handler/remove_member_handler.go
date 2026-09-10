package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"
)

func (h *Handler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	id, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid project ID")
		return
	}
	targetUserID, err := parsePathUUID(r, "userId")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid user ID")
		return
	}
	if err := h.service.RemoveMember(r.Context(), id, wsID, targetUserID, userID); err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrProjectNotFound):
			response.Error(w, http.StatusNotFound, "project not found")
		case errors.Is(err, constant.ErrUserNotFound):
			response.Error(w, http.StatusNotFound, "user not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "member removed"})
}
