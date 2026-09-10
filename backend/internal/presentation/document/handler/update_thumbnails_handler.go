package handler

import (
	"net/http"

	"backend/internal/presentation/document/presenter"
	"backend/internal/presentation/response"
)

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
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "thumbnails updated"})
}
