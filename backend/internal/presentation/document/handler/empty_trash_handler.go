package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"
)

func (h *Handler) EmptyTrash(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	if err := h.service.EmptyTrash(r.Context(), wsID, userID); err != nil {
		if errors.Is(err, constant.ErrForbidden) {
			response.Error(w, http.StatusForbidden, "forbidden: admin or owner role required")
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "trash emptied"})
}
