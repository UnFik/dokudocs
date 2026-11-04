// Package pdfexport prints a Markdown document's page to PDF for someone who can read it.
package pdfexport

import (
	"context"
	"errors"
	"html"
	"log/slog"
	"time"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// ErrNotMarkdown means the document is not a Markdown document, the only kind
// whose page the browser builds for printing.
var ErrNotMarkdown = errors.New("pdfexport: not a markdown document")

// What can go wrong while the PDF service prints. A Renderer returns these.
var (
	// ErrUnavailable: the service is switched off, cannot be reached, or failed.
	ErrUnavailable = errors.New("pdfexport: the PDF service is unavailable")
	// ErrBusy: the service is already printing as many pages as it is allowed.
	ErrBusy = errors.New("pdfexport: the PDF service is busy")
	// ErrTimeout: printing took longer than the limit.
	ErrTimeout = errors.New("pdfexport: printing took too long")
	// ErrRefused: the service would not print this page, and trying again will not help.
	ErrRefused = errors.New("pdfexport: the PDF service refused the page")
)

// policy is the first thing in the page's head, so nothing after it can loosen
// it: the page may load nothing but its own inline styles and data: URIs.
const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">`

// Documents reads a document under the caller's own access: someone who cannot
// read it, or a trashed document, is not found.
type Documents interface {
	GetDocument(ctx context.Context, id, workspaceID, userID uuid.UUID) (model.Document, error)
}

// Renderer prints a complete HTML document to PDF.
type Renderer interface {
	Convert(ctx context.Context, page []byte) ([]byte, error)
}

// Request is the page the browser built for the document.
type Request struct {
	Title string
	HTML  string
}

// Service checks access and prints the page.
type Service struct {
	documents Documents
	renderer  Renderer
}

// New returns a service that reads documents from documents and prints with renderer.
func New(documents Documents, renderer Renderer) *Service {
	return &Service{documents: documents, renderer: renderer}
}

// PDF prints request for a caller who can read the document. It logs the size of
// the request, how long printing took and how it ended, never the document.
func (s *Service) PDF(ctx context.Context, workspaceID, documentID, userID uuid.UUID, request Request) ([]byte, error) {
	document, err := s.documents.GetDocument(ctx, documentID, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	if document.Type != "markdown" {
		return nil, ErrNotMarkdown
	}
	page := "<!doctype html><html><head>" + policy + "<meta charset=\"utf-8\"><title>" + html.EscapeString(request.Title) + "</title></head><body>" + request.HTML + "</body></html>"
	started := time.Now()
	pdf, err := s.renderer.Convert(ctx, []byte(page))
	slog.InfoContext(ctx, "pdf export",
		"document_id", documentID,
		"bytes", len(request.HTML),
		"duration_ms", time.Since(started).Milliseconds(),
		"outcome", outcome(err),
	)
	return pdf, err
}

func outcome(err error) string {
	switch {
	case err == nil:
		return "printed"
	case errors.Is(err, ErrBusy):
		return "busy"
	case errors.Is(err, ErrTimeout):
		return "timeout"
	case errors.Is(err, ErrRefused):
		return "refused"
	default:
		return "unavailable"
	}
}
