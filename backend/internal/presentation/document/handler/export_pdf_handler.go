package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"backend/internal/application/pdfexport"
	"backend/internal/presentation/response"
)

// ExportPDFHandler prints a Markdown document's page to PDF. The browser builds
// the page; the service that prints it runs apart from the API.
type ExportPDFHandler struct {
	service      *pdfexport.Service
	maxBytes     int64
	printTimeout time.Duration
}

// NewExportPDFHandler limits a request body to maxBytes. printTimeout is how long
// the service may take to print; the connection is held that long and a little more.
func NewExportPDFHandler(service *pdfexport.Service, maxBytes int64, printTimeout time.Duration) *ExportPDFHandler {
	return &ExportPDFHandler{service: service, maxBytes: maxBytes, printTimeout: printTimeout}
}

// ExportPDFRequest is the page the browser built for the document.
type ExportPDFRequest struct {
	Title string `json:"title"`
	HTML  string `json:"html"`
}

// PDF answers with the document as a PDF file.
// @Summary Export a Markdown document as PDF
// @Description Prints the page the browser built for a Markdown document, for someone who can read it. The page may load nothing from the network and runs no script.
// @Tags Document
// @Accept json
// @Produce application/pdf
// @Security BearerAuth
// @Param X-Workspace-Id header string true "Workspace ID (UUID)"
// @Param id path string true "Document ID (UUID)"
// @Param body body ExportPDFRequest true "Document title and its page as HTML"
// @Success 200 {file} binary
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 413 {object} response.ErrorEnvelope
// @Failure 429 {object} response.ErrorEnvelope
// @Failure 502 {object} response.ErrorEnvelope
// @Failure 503 {object} response.ErrorEnvelope
// @Failure 504 {object} response.ErrorEnvelope
// @Router /documents/{id}/export/pdf [post]
func (h *ExportPDFHandler) PDF(w http.ResponseWriter, r *http.Request) {
	userID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document id")
		return
	}
	// The server's own read and write deadlines suit short JSON calls: a large page
	// takes longer to arrive, and printing takes longer still.
	deadline := time.Now().Add(h.printTimeout + 30*time.Second)
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(deadline)
	_ = controller.SetWriteDeadline(deadline)
	var body ExportPDFRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, h.maxBytes)).Decode(&body); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			response.Error(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("the document is too large to export as PDF (the limit is %d MB)", max(h.maxBytes>>20, 1)))
			return
		}
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	pdf, err := h.service.PDF(r.Context(), workspaceID, documentID, userID, pdfexport.Request{Title: body.Title, HTML: body.HTML})
	switch {
	case errors.Is(err, pdfexport.ErrNotMarkdown):
		response.Error(w, http.StatusBadRequest, "only Markdown documents can be exported to PDF")
		return
	case errors.Is(err, pdfexport.ErrBusy):
		response.Error(w, http.StatusServiceUnavailable, "PDF export is busy, try again in a moment")
		return
	case errors.Is(err, pdfexport.ErrUnavailable):
		response.Error(w, http.StatusServiceUnavailable, "PDF export is unavailable right now")
		return
	case errors.Is(err, pdfexport.ErrTimeout):
		response.Error(w, http.StatusGatewayTimeout, "PDF export took too long")
		return
	case errors.Is(err, pdfexport.ErrRefused):
		response.Error(w, http.StatusBadGateway, "the document could not be printed to PDF")
		return
	case err != nil:
		writeDocumentError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `attachment; filename="document.pdf"`)
	_, _ = w.Write(pdf)
}
