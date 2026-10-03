package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"backend/constant"
	appdoc "backend/internal/application/document/usecase"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type CommentHandler struct {
	service  *appdoc.CommentUseCase
	notifier CommentNotifier
}

// CommentNotifier tells the people connected to a document that its comments
// changed.
type CommentNotifier interface {
	NotifyComments(documentID uuid.UUID)
}

// WithNotifier makes every successful write wake the document's room.
func (h *CommentHandler) WithNotifier(notifier CommentNotifier) *CommentHandler {
	h.notifier = notifier
	return h
}

func (h *CommentHandler) notify(documentID uuid.UUID) {
	if h.notifier != nil {
		h.notifier.NotifyComments(documentID)
	}
}

func NewCommentHandler(service *appdoc.CommentUseCase) *CommentHandler {
	return &CommentHandler{service: service}
}

func (h *CommentHandler) List(w http.ResponseWriter, r *http.Request) {
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

type commentRequest struct {
	ThreadID     uuid.UUID       `json:"threadID"`
	SelectedText string          `json:"selectedText"`
	Content      string          `json:"content"`
	Anchor       json.RawMessage `json:"anchor"`
}

func (h *CommentHandler) Create(w http.ResponseWriter, r *http.Request) {
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
	var request commentRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.service.Create(r.Context(), appdoc.CommentInput{
		WorkspaceID: workspaceID, DocumentID: documentID, ThreadID: request.ThreadID, AuthorID: actorID,
		SelectedText: request.SelectedText, Content: request.Content, Anchor: request.Anchor,
	}); err != nil {
		h.writeError(w, err)
		return
	}
	h.notify(documentID)
	w.WriteHeader(http.StatusCreated)
}

type commentReplyRequest struct {
	ReplyID uuid.UUID `json:"replyID"`
	Content string    `json:"content"`
}

func (h *CommentHandler) Reply(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, documentID, threadID, ok := h.threadPath(w, r)
	if !ok {
		return
	}
	var request commentReplyRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.service.Reply(r.Context(), appdoc.CommentReplyInput{
		WorkspaceID: workspaceID, DocumentID: documentID, ThreadID: threadID,
		ReplyID: request.ReplyID, AuthorID: actorID, Content: request.Content,
	}); err != nil {
		h.writeError(w, err)
		return
	}
	h.notify(documentID)
	w.WriteHeader(http.StatusCreated)
}

func (h *CommentHandler) Resolve(w http.ResponseWriter, r *http.Request) {
	h.setResolved(w, r, true)
}

func (h *CommentHandler) Reopen(w http.ResponseWriter, r *http.Request) {
	h.setResolved(w, r, false)
}

func (h *CommentHandler) setResolved(w http.ResponseWriter, r *http.Request, resolved bool) {
	actorID, workspaceID, documentID, threadID, ok := h.threadPath(w, r)
	if !ok {
		return
	}
	if err := h.service.Resolve(r.Context(), workspaceID, documentID, threadID, actorID, resolved); err != nil {
		h.writeError(w, err)
		return
	}
	h.notify(documentID)
	w.WriteHeader(http.StatusNoContent)
}

type commentEditRequest struct {
	Content string `json:"content"`
}

func (h *CommentHandler) Edit(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, documentID, threadID, ok := h.threadPath(w, r)
	if !ok {
		return
	}
	var request commentEditRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.service.Edit(r.Context(), workspaceID, documentID, threadID, actorID, request.Content); err != nil {
		h.writeError(w, err)
		return
	}
	h.notify(documentID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *CommentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, documentID, threadID, ok := h.threadPath(w, r)
	if !ok {
		return
	}
	if err := h.service.Delete(r.Context(), workspaceID, documentID, threadID, actorID); err != nil {
		h.writeError(w, err)
		return
	}
	h.notify(documentID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *CommentHandler) EditReply(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, documentID, threadID, replyID, ok := h.replyPath(w, r)
	if !ok {
		return
	}
	var request commentEditRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.service.EditReply(r.Context(), workspaceID, documentID, threadID, replyID, actorID, request.Content); err != nil {
		h.writeError(w, err)
		return
	}
	h.notify(documentID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *CommentHandler) DeleteReply(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, documentID, threadID, replyID, ok := h.replyPath(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteReply(r.Context(), workspaceID, documentID, threadID, replyID, actorID); err != nil {
		h.writeError(w, err)
		return
	}
	h.notify(documentID)
	w.WriteHeader(http.StatusNoContent)
}

func (h *CommentHandler) replyPath(w http.ResponseWriter, r *http.Request) (actorID, workspaceID, documentID, threadID, replyID uuid.UUID, ok bool) {
	actorID, workspaceID, documentID, threadID, ok = h.threadPath(w, r)
	if !ok {
		return
	}
	replyID, err := parsePathUUID(r, "replyID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid reply ID")
		return uuid.Nil, uuid.Nil, uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return actorID, workspaceID, documentID, threadID, replyID, true
}

func (h *CommentHandler) threadPath(w http.ResponseWriter, r *http.Request) (actorID, workspaceID, documentID, threadID uuid.UUID, ok bool) {
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
	threadID, err = parsePathUUID(r, "threadID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid thread ID")
		return
	}
	return actorID, workspaceID, documentID, threadID, true
}

func (h *CommentHandler) writeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, appdoc.ErrInvalidComment):
		response.Error(w, http.StatusBadRequest, "invalid comment")
	case errors.Is(err, constant.ErrForbidden):
		response.Error(w, http.StatusForbidden, "forbidden")
	default:
		writeDocumentError(w, err)
	}
}
