package handler

import (
	"context"
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/agent"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type RAGChatHandler struct {
	service *appchat.ChatUseCase
	agent   *agentMode
}

func NewRAGChatHandler(service *appchat.ChatUseCase) *RAGChatHandler {
	return &RAGChatHandler{service: service}
}

// ActionLister lists the actions the Agent asked for in a Conversation.
type ActionLister interface {
	PendingActions(ctx context.Context, conversationID, userID uuid.UUID) ([]agent.PendingAction, error)
}

type agentMode struct {
	chat    *agent.ChatService
	ready   func(context.Context) bool
	actions ActionLister
}

// WithAgent answers with the Agent whenever an agent model is set up; otherwise
// chat answers from documents only, as before.
func (h *RAGChatHandler) WithAgent(chat *agent.ChatService, ready func(context.Context) bool, actions ActionLister) *RAGChatHandler {
	h.agent = &agentMode{chat: chat, ready: ready, actions: actions}
	return h
}

func (h *RAGChatHandler) CreateConversation(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	var request struct {
		DocumentID string `json:"documentId"`
	}
	if r.ContentLength != 0 {
		if err := response.DecodeJSON(r, &request); err != nil && err.Error() != "empty body" {
			response.Error(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}
	var conversation model.RAGConversation
	if request.DocumentID != "" {
		documentID, parseErr := uuid.Parse(request.DocumentID)
		if parseErr != nil {
			response.Error(w, http.StatusBadRequest, "invalid document ID")
			return
		}
		conversation, err = h.service.CreateDocumentConversation(r.Context(), workspaceID, actorID, documentID)
	} else {
		conversation, err = h.service.CreateConversation(r.Context(), workspaceID, actorID)
	}
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
	actions := []agent.PendingAction{}
	if h.agent != nil {
		if actions, err = h.agent.actions.PendingActions(r.Context(), conversationID, actorID); err != nil {
			writeRAGChatError(w, err)
			return
		}
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"conversation": history.Conversation, "messages": history.Messages, "actions": actions})
}

// ListDocumentConversations lists the User's own Conversations on one document.
func (h *RAGChatHandler) ListDocumentConversations(w http.ResponseWriter, r *http.Request) {
	actorID, err := authenticatedRAGUserID(r)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	documentID, err := parsePathUUID(r, "documentID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid document ID")
		return
	}
	conversations, err := h.service.ListDocumentConversations(r.Context(), actorID, documentID)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, conversations)
}

// DecideAction approves or declines an action the Agent asked for.
func (h *RAGChatHandler) DecideAction(w http.ResponseWriter, r *http.Request) {
	actorID, err := authenticatedRAGUserID(r)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	actionID, err := parsePathUUID(r, "actionID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid action ID")
		return
	}
	if h.agent == nil {
		response.Error(w, http.StatusNotFound, "there is no such action")
		return
	}
	var request struct {
		Approve bool `json:"approve"`
	}
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	action, err := h.agent.chat.Decide(r.Context(), actorID, actionID, request.Approve)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, action)
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
	if h.agent != nil && h.agent.ready(r.Context()) {
		answer, err := h.agent.chat.Ask(r.Context(), agent.ChatInput{
			WorkspaceID: workspaceID, ConversationID: conversationID, ActorID: actorID,
			Question: request.Question, Language: request.Language,
		})
		if err != nil {
			writeRAGChatError(w, err)
			return
		}
		_ = response.Data(w, http.StatusOK, map[string]any{
			"conversationId": answer.ConversationID, "text": answer.Text, "citations": []model.RAGCitation{},
			"coveragePartial": false, "sourcesMayBeIncomplete": false, "agent": true, "tools": answer.Tools, "actions": answer.Actions,
		})
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
	case errors.Is(err, agent.ErrUnknownSkill):
		response.Error(w, http.StatusBadRequest, "there is no skill with that name")
	case errors.Is(err, agent.ErrInvalidArguments):
		response.Error(w, http.StatusBadRequest, "invalid chatbot request")
	case errors.Is(err, agent.ErrActionNotFound):
		response.Error(w, http.StatusNotFound, "there is no such action")
	case errors.Is(err, agent.ErrAgentNotConfigured):
		response.Error(w, http.StatusServiceUnavailable, "the agent model is not configured")
	case errorsAsToolError(err):
		response.Error(w, http.StatusConflict, err.Error())
	default:
		response.Error(w, http.StatusInternalServerError, "internal server error")
	}
}

func errorsAsToolError(err error) bool {
	var refusal *agent.ToolError
	return errors.As(err, &refusal)
}
