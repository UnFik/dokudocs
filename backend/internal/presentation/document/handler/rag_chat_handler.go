package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type RAGChatHandler struct {
	service *appchat.ChatUseCase
}

func NewRAGChatHandler(service *appchat.ChatUseCase) *RAGChatHandler {
	return &RAGChatHandler{service: service}
}

func (h *RAGChatHandler) CreateConversation(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	conversation, err := h.service.CreateConversation(r.Context(), workspaceID, actorID)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusCreated, conversation)
}

func (h *RAGChatHandler) GetConversation(w http.ResponseWriter, r *http.Request) {
	actorID, err := authenticatedRAGUserID(r)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	conversationID, err := parsePathUUID(r, "conversationID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid conversation ID")
		return
	}
	history, err := h.service.GetConversation(r.Context(), conversationID, actorID)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, history)
}

func (h *RAGChatHandler) ListConversations(w http.ResponseWriter, r *http.Request) {
	actorID, err := authenticatedRAGUserID(r)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	conversations, err := h.service.ListConversations(r.Context(), actorID)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, conversations)
}

func (h *RAGChatHandler) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	actorID, err := authenticatedRAGUserID(r)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	conversationID, err := parsePathUUID(r, "conversationID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid conversation ID")
		return
	}
	if err := h.service.DeleteConversation(r.Context(), conversationID, actorID); err != nil {
		writeRAGChatError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *RAGChatHandler) Ask(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	conversationID, err := parsePathUUID(r, "conversationID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid conversation ID")
		return
	}
	var request struct {
		Question         string   `json:"question"`
		Language         string   `json:"language"`
		PublicLinkTokens []string `json:"publicLinkTokens"`
	}
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	answer, err := h.service.Ask(r.Context(), appchat.AskInput{
		WorkspaceID: workspaceID, ConversationID: conversationID, ActorID: actorID,
		Question: request.Question, Language: request.Language, PublicLinkTokens: request.PublicLinkTokens,
	})
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, answer)
}

func authenticatedRAGUserID(r *http.Request) (uuid.UUID, error) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		return uuid.Nil, constant.ErrUnauthorized
	}
	userID, err := uuid.Parse(user.ID)
	if err != nil || userID == uuid.Nil {
		return uuid.Nil, constant.ErrUnauthorized
	}
	return userID, nil
}

func writeRAGChatError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, appchat.ErrInvalidChatRequest):
		response.Error(w, http.StatusBadRequest, "invalid chatbot request")
	case errors.Is(err, constant.ErrUnauthorized):
		response.Error(w, http.StatusUnauthorized, "unauthorized")
	case errors.Is(err, constant.ErrForbidden):
		response.Error(w, http.StatusForbidden, "forbidden")
	case errors.Is(err, constant.ErrDocumentNotFound):
		response.Error(w, http.StatusNotFound, "conversation not found")
	case errors.Is(err, constant.ErrDocumentConflict):
		response.Error(w, http.StatusConflict, "source changed; ask again")
	case errors.Is(err, appchat.ErrAnswerModelUnavailable):
		response.Error(w, http.StatusServiceUnavailable, "chat model is not configured")
	case errors.Is(err, appchat.ErrRAGProviderUnavailable):
		response.Error(w, http.StatusServiceUnavailable, "chat model provider is temporarily unavailable")
	default:
		response.Error(w, http.StatusInternalServerError, "internal server error")
	}
}
