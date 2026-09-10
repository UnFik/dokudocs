package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/project/presenter"
	"backend/internal/presentation/response"
)

func (h *Handler) UpdateCategory(w http.ResponseWriter, r *http.Request) {
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
	catID, err := parsePathUUID(r, "categoryId")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid category ID")
		return
	}
	var req presenter.UpdateCategoryRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.service.UpdateCategory(r.Context(), id, catID, wsID, userID, req.Name, req.ColorID); err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrProjectNotFound):
			response.Error(w, http.StatusNotFound, "project not found")
		case errors.Is(err, constant.ErrCategoryNotFound):
			response.Error(w, http.StatusNotFound, "category not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "updated"})
}
