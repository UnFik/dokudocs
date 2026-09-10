package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/project/presenter"
	"backend/internal/presentation/response"
)

func (h *Handler) AddCategory(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.AddCategoryRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" {
		response.Error(w, http.StatusBadRequest, "category name is required")
		return
	}
	cat, err := h.service.AddCategory(r.Context(), id, wsID, userID, req.Name, req.ColorID)
	if err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrProjectNotFound):
			response.Error(w, http.StatusNotFound, "project not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusCreated, cat)
}
