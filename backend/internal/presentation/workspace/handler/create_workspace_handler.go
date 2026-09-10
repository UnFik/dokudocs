package handler

import (
	"net/http"

	"backend/internal/application/workspace/dto"
	"backend/internal/presentation/response"
	"backend/internal/presentation/workspace/presenter"
)

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, err := getUserUUID(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req presenter.CreateWorkspaceRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" {
		response.Error(w, http.StatusBadRequest, "workspace name is required")
		return
	}
	ws, err := h.service.CreateWorkspace(r.Context(), dto.CreateWorkspaceInput{
		Name:    req.Name,
		Plan:    req.Plan,
		LogoURL: req.LogoURL,
		UserID:  userID,
	})
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusCreated, ws)
}
