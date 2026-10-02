package handler

import (
	"net/http"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
)

// Duplicate duplicates an existing document.
// @Summary Duplicate document
// @Description Create a duplicate of an existing document
// @Tags Document
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param Idempotency-Key header string true "Stable request ID (UUID); reuse on retry"
// @Param id path string true "Document ID (UUID)"
// @Success 201 {object} response.Envelope{data=model.Document}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents/{id}/duplicate [post]
func (h *Handler) Duplicate(w http.ResponseWriter, r *http.Request) {
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
	requestID, err := parseIdempotencyKey(r)
	if err != nil {
		response.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	doc, err := h.service.DuplicateDocument(r.Context(), id, wsID, userID, requestID)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusCreated, doc)
}
