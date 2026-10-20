package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/htmlpage"
	"backend/internal/presentation/response"
)

// PageHandler opens HTML documents in a sandboxed frame (ADR 0052): the
// application asks for a ticket, and the frame fetches the page from the
// separate content origin with it.
type PageHandler struct{ service *htmlpage.Service }

func NewPageHandler(service *htmlpage.Service) *PageHandler { return &PageHandler{service: service} }

// Ticket gives a viewer who can read the page a short-lived address for its frame.
func (h *PageHandler) Ticket(w http.ResponseWriter, r *http.Request) {
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
	ticket, err := h.service.Issue(r.Context(), workspaceID, documentID, userID)
	switch {
	case errors.Is(err, htmlpage.ErrNotAPage):
		response.Error(w, http.StatusBadRequest, "this document is not an html page")
	case err != nil:
		writeDocumentError(w, err)
	default:
		_ = response.Data(w, http.StatusOK, ticket)
	}
}

// Serve answers on the content origin only. The token is the whole credential:
// it names one viewer and one page, and the viewer's access is checked again here.
func (h *PageHandler) Serve(w http.ResponseWriter, r *http.Request) {
	page, err := h.service.Render(r.Context(), r.PathValue("token"))
	if err != nil {
		status := http.StatusNotFound
		if errors.Is(err, htmlpage.ErrInvalidToken) {
			status = http.StatusUnauthorized
		} else if !errors.Is(err, constant.ErrDocumentNotFound) && !errors.Is(err, constant.ErrForbidden) && !errors.Is(err, htmlpage.ErrNotAPage) {
			status = http.StatusInternalServerError
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(http.StatusText(status)))
		return
	}
	for name, value := range page.Headers {
		w.Header().Set(name, value)
	}
	_, _ = w.Write([]byte(page.Body))
}
