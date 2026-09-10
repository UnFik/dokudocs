package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/document/presenter"
	"backend/internal/presentation/response"
)

func (h *Handler) AddAccess(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.AddAccessRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Email == "" {
		response.Error(w, http.StatusBadRequest, "email is required")
		return
	}
	if err := h.service.AddOrUpdateAccess(r.Context(), id, wsID, userID, req.Email, req.Level); err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrUserNotFound):
			response.Error(w, http.StatusNotFound, "user not found")
		default:
			response.Error(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusCreated, map[string]string{"status": "access granted"})
}
