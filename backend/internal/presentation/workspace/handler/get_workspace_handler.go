package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	userID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	idStr := r.PathValue("id")
	wsID, err := uuid.Parse(idStr)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid workspace ID")
		return
	}
	ws, err := h.service.GetWorkspace(r.Context(), wsID, userID)
	if err != nil {
		if errors.Is(err, constant.ErrWorkspaceNotFound) {
			response.Error(w, http.StatusNotFound, "workspace not found")
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, ws)
}
