package handler

import (
	"net/http"

	_ "backend/internal/domain/model"
	"backend/internal/presentation/response"
)

// GetPublic retrieves a public shared document by share token.
// @Summary Get public document
// @Description View a public document using a shared token
// @Tags Document
// @Produce json
// @Param shareToken path string true "Document Share Token"
// @Success 200 {object} response.Envelope{data=model.Document}
// @Failure 404 {object} response.ErrorEnvelope
// @Router /public/documents/{shareToken} [get]
func (h *Handler) GetPublic(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("shareToken")
	doc, err := h.service.GetPublicDocument(r.Context(), token)
	if err != nil {
		response.Error(w, http.StatusNotFound, "document not found")
		return
	}
	_ = response.Data(w, http.StatusOK, doc)
}
