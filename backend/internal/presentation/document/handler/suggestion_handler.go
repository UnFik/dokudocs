package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	appdoc "backend/internal/application/document/usecase"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type SuggestionHandler struct {
	service *appdoc.SuggestionUseCase
}

func NewSuggestionHandler(service *appdoc.SuggestionUseCase) *SuggestionHandler {
	return &SuggestionHandler{service: service}
}

func (h *SuggestionHandler) List(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	items, err := h.service.List(r.Context(), workspaceID, documentID, actorID)
	if err != nil {
		h.writeError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, items)
}

type suggestionReplyRequest struct {
	ReplyID uuid.UUID `json:"replyID"`
	Body    string    `json:"body"`
}

func (h *SuggestionHandler) Reply(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, documentID, suggestionID, ok := h.suggestionPath(w, r)
	if !ok {
		return
	}
	var request suggestionReplyRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.service.Reply(r.Context(), appdoc.SuggestionReplyInput{
		WorkspaceID: workspaceID, DocumentID: documentID, SuggestionID: suggestionID,
		ReplyID: request.ReplyID, AuthorID: actorID, Body: request.Body,
	}); err != nil {
		h.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *SuggestionHandler) Resolve(w http.ResponseWriter, r *http.Request) {
	h.setResolved(w, r, true)
}

func (h *SuggestionHandler) Reopen(w http.ResponseWriter, r *http.Request) {
	h.setResolved(w, r, false)
}

func (h *SuggestionHandler) setResolved(w http.ResponseWriter, r *http.Request, resolved bool) {
	actorID, workspaceID, documentID, suggestionID, ok := h.suggestionPath(w, r)
	if !ok {
		return
	}
	if err := h.service.Resolve(r.Context(), workspaceID, documentID, suggestionID, actorID, resolved); err != nil {
		h.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SuggestionHandler) suggestionPath(w http.ResponseWriter, r *http.Request) (actorID, workspaceID, documentID, suggestionID uuid.UUID, ok bool) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	documentID, err = parsePathUUID(r, "id")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	suggestionID, err = parsePathUUID(r, "suggestionID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid suggestion ID")
		return
	}
	return actorID, workspaceID, documentID, suggestionID, true
}

func (h *SuggestionHandler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, appdoc.ErrInvalidSuggestion):
		response.Error(w, http.StatusBadRequest, "invalid suggestion")
	case errors.Is(err, constant.ErrForbidden):
		response.Error(w, http.StatusForbidden, "forbidden")
	default:
		writeDocumentError(w, err)
	}
}
