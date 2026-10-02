package handler

import (
	"net/http"

	"backend/internal/application/document/dto"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/document/presenter"
	"backend/internal/presentation/response"
)

// Update updates an existing document by ID.
// @Summary Update document
// @Description Update document details
// @Tags Document
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID (UUID)"
// @Param request body presenter.UpdateDocumentRequest true "Document update payload"
// @Success 200 {object} response.Envelope{data=model.Document}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents/{id} [put]
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
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, doc)
}
