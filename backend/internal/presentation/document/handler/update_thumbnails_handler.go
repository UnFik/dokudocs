package handler

import (
	"net/http"

	"backend/internal/presentation/document/presenter"
	"backend/internal/presentation/response"
)

// UpdateThumbnails updates document preview thumbnails.
// @Summary Update document thumbnails
// @Description Update thumbnail URLs for a document
// @Tags Document
// @Accept json
// @Produce json
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID (UUID)"
// @Param request body presenter.ThumbnailsRequest true "Thumbnails payload"
// @Success 200 {object} response.Envelope{data=map[string]string}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /documents/{id}/thumbnails [put]
func (h *Handler) UpdateThumbnails(w http.ResponseWriter, r *http.Request) {
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
	var req presenter.ThumbnailsRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.service.UpdateThumbnails(r.Context(), id, wsID, userID, req.Thumbnail, req.ThumbnailDark, req.ThumbnailPreview, req.ThumbnailPreviewDark); err != nil {
		writeDocumentError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "thumbnails updated"})
}
