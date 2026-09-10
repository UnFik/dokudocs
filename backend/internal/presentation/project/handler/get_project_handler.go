package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"
)

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
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
	p, err := h.service.GetProject(r.Context(), id, wsID, userID)
	if err != nil {
		if errors.Is(err, constant.ErrProjectNotFound) {
			response.Error(w, http.StatusNotFound, "project not found")
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, p)
}
