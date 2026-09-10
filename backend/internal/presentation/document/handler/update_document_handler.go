package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/document/dto"
	"backend/internal/presentation/document/presenter"
	"backend/internal/presentation/response"
)

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.UpdateDocumentRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	doc, err := h.service.UpdateDocument(r.Context(), dto.UpdateDocumentInput{
		ID:          id,
		WorkspaceID: wsID,
		UserID:      userID,
		Title:       req.Title,
		Content:     req.Content,
		Visibility:  req.Visibility,
		Tags:        req.Tags,
		Categories:  req.Categories,
		IsDraft:     req.IsDraft,
		ProjectID:   req.ProjectID,
	})
	if err != nil {
		switch {
		case errors.Is(err, constant.ErrForbidden):
			response.Error(w, http.StatusForbidden, "forbidden: insufficient permission")
		case errors.Is(err, constant.ErrDocumentNotFound):
			response.Error(w, http.StatusNotFound, "document not found")
		default:
			response.Error(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	_ = response.Data(w, http.StatusOK, doc)
}
