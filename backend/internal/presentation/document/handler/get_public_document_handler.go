package handler

import (
	"net/http"

	"backend/internal/presentation/response"
)

func (h *Handler) GetPublic(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("shareToken")
	doc, err := h.service.GetPublicDocument(r.Context(), token)
	if err != nil {
		response.Error(w, http.StatusNotFound, "document not found")
		return
	}
	_ = response.Data(w, http.StatusOK, doc)
}
