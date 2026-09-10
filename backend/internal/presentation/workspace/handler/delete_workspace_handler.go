package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
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
	if err := h.service.DeleteWorkspace(r.Context(), wsID, userID); err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: owner role required")
		case errors.Is(err, constant.ErrWorkspaceNotFound):
			response.Error(w, http.StatusNotFound, "workspace not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "deleted"})
}
