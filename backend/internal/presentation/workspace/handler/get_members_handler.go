package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

func (h *Handler) GetMembers(w http.ResponseWriter, r *http.Request) {
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
	members, err := h.service.GetMembers(r.Context(), wsID, userID)
	if err != nil {
		if errors.Is(err, constant.ErrForbidden) {
			response.Error(w, http.StatusForbidden, "not a member of this workspace")
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, members)
}
