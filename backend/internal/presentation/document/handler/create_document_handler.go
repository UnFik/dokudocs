package handler

import (
	"net/http"

	"backend/internal/application/document/dto"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/document/presenter"
	"backend/internal/presentation/response"
)

// Create creates a new document in the active workspace.
// @Summary Create document
// @Description Create a document. Markdown may include an initial AST body stored atomically with its metadata.
// @Tags Document
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param Idempotency-Key header string true "Stable request ID (UUID); reuse on retry"
// @Param request body presenter.CreateDocumentRequest true "Document creation payload"
// @Success 201 {object} response.Envelope{data=model.Document}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents [post]
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
	requestID, err := parseIdempotencyKey(r)
	if err != nil {
		response.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	input := dto.CreateDocumentInput{
		WorkspaceID: wsID,
		UserID:      userID,
		RequestID:   requestID,
		Title:       req.Title,
		Type:        req.Type,
		Content:     req.Content,
		ContentJSON: req.ContentJSON,
		Visibility:  req.Visibility,
		Tags:        req.Tags,
		Categories:  req.Categories,
		IsDraft:     req.IsDraft,
		ProjectID:   req.ProjectID,
	}
	doc, err := h.service.CreateDocument(r.Context(), input)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusCreated, doc)
}
