package handler

import (
	"net/http"

	"backend/internal/application/document/dto"
	"backend/internal/presentation/document/presenter"
	"backend/internal/presentation/response"
)

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID, wsID, err := getUserAndWorkspace(r)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req presenter.CreateDocumentRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	doc, err := h.service.CreateDocument(r.Context(), dto.CreateDocumentInput{
		WorkspaceID: wsID,
		UserID:      userID,
		Title:       req.Title,
		Type:        req.Type,
		Content:     req.Content,
		Visibility:  req.Visibility,
		Tags:        req.Tags,
		Categories:  req.Categories,
		IsDraft:     req.IsDraft,
		ProjectID:   req.ProjectID,
	})
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusCreated, doc)
}
