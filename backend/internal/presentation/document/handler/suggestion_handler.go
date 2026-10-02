package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/collaboration"
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

type suggestionRequest struct {
	SuggestionID           uuid.UUID       `json:"suggestionID"`
	BaseBodyVersion        int64           `json:"baseBodyVersion"`
	BaseBodyEpoch          int64           `json:"baseBodyEpoch"`
	OperationSchemaVersion int             `json:"operationSchemaVersion"`
	Provenance             string          `json:"provenance"`
	Operations             json.RawMessage `json:"operations"`
	Summary                string          `json:"summary"`
	Reason                 string          `json:"reason"`
}

func (h *SuggestionHandler) Propose(w http.ResponseWriter, r *http.Request) {
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
	var request suggestionRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	err = h.service.Propose(r.Context(), appdoc.SuggestionInput{
		WorkspaceID: workspaceID, DocumentID: documentID, SuggestionID: request.SuggestionID,
		ProposerID: actorID, BaseBodyVersion: request.BaseBodyVersion, BaseBodyEpoch: request.BaseBodyEpoch,
		OperationSchemaVersion: request.OperationSchemaVersion, Provenance: request.Provenance,
		Operations: request.Operations, Summary: request.Summary, Reason: request.Reason,
	})
	if err != nil {
		h.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusCreated)
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

func (h *SuggestionHandler) Reject(w http.ResponseWriter, r *http.Request) {
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
	suggestionID, err := parsePathUUID(r, "suggestionID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid suggestion ID")
		return
	}
	if err := h.service.Reject(r.Context(), workspaceID, documentID, suggestionID, actorID); err != nil {
		h.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *SuggestionHandler) Accept(w http.ResponseWriter, r *http.Request) {
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
	suggestionID, err := parsePathUUID(r, "suggestionID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid suggestion ID")
		return
	}
	if err := h.service.Accept(r.Context(), workspaceID, documentID, suggestionID, actorID); err != nil {
		h.writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
	case errors.Is(err, constant.ErrForbidden), errors.Is(err, appdoc.ErrSuggestionHidden):
		response.Error(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, appdoc.ErrSuggestionDecision):
		response.Error(w, http.StatusConflict, "suggestion decision is not allowed")
	case errors.Is(err, collaboration.ErrSuggestionConflict):
		response.Error(w, http.StatusConflict, "suggestion conflict")
	default:
		writeDocumentError(w, err)
	}
}
