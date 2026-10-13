package handler

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/constant"
	"backend/internal/application/agent"
	"backend/internal/application/airuns"
	"backend/internal/application/aiusage"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

type RAGChatHandler struct {
	service *appchat.ChatUseCase
	agent   *agentMode
	runs    *airuns.Service
	timeout time.Duration
	limits  *aiusage.Limits
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

// WithLimits refuses a new question once the User has spent the month's Usage limit.
func (h *RAGChatHandler) WithLimits(limits *aiusage.Limits) *RAGChatHandler {
	h.limits = limits
	return h
}

// checkLimit refuses a new question when the Usage limit is spent.
func (h *RAGChatHandler) checkLimit(ctx context.Context, actorID, workspaceID uuid.UUID) error {
	if h.limits == nil {
		return nil
	}
	return h.limits.Check(ctx, actorID, workspaceID)
}

// Usage reports how much of the month's Usage limit the User has spent in the workspace.
func (h *RAGChatHandler) Usage(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	if h.limits == nil {
		response.Error(w, http.StatusNotFound, "usage is not tracked")
		return
	}
	status, err := h.limits.Status(r.Context(), actorID, workspaceID)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, status)
}

// WithRuns makes chat jobs outlive the request that started them. A run lasts at
// most timeout.
func (h *RAGChatHandler) WithRuns(runs *airuns.Service, timeout time.Duration) *RAGChatHandler {
	if runs == nil {
		return h
	}
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	h.runs, h.timeout = runs, timeout
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
	limit := appchat.DefaultHistoryPage
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if limit, err = strconv.Atoi(raw); err != nil || limit < 1 {
			response.Error(w, http.StatusBadRequest, "invalid limit")
			return
		}
	}
	cursor := r.URL.Query().Get("before")
	history, next, err := h.service.GetConversationPage(r.Context(), conversationID, actorID, cursor, limit)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	// Pending actions belong to the newest messages, so only the first page carries them.
	actions := []agent.PendingAction{}
	if h.agent != nil && cursor == "" {
		if actions, err = h.agent.actions.PendingActions(r.Context(), conversationID, actorID); err != nil {
			writeRAGChatError(w, err)
			return
		}
	}
	var nextCursor *string
	if next != "" {
		nextCursor = &next
	}
	_ = response.Data(w, http.StatusOK, map[string]any{"conversation": history.Conversation, "messages": history.Messages, "actions": actions, "nextCursor": nextCursor})
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

type updateConversationRequest struct {
	Title    *string `json:"title"`
	Pinned   *bool   `json:"pinned"`
	Archived *bool   `json:"archived"`
}

func (h *RAGChatHandler) UpdateConversation(w http.ResponseWriter, r *http.Request) {
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
	var request updateConversationRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}
	conversation, err := h.service.UpdateConversation(r.Context(), conversationID, actorID, model.RAGConversationPatch{
		Title: request.Title, Pinned: request.Pinned, Archived: request.Archived,
	})
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, conversation)
}

func (h *RAGChatHandler) MarkConversationRead(w http.ResponseWriter, r *http.Request) {
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
	if err := h.service.MarkConversationRead(r.Context(), conversationID, actorID); err != nil {
		writeRAGChatError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
	if h.runs != nil {
		h.runs.CancelConversation(r.Context(), actorID, conversationID)
	}
	if err := h.service.DeleteConversation(r.Context(), conversationID, actorID); err != nil {
		writeRAGChatError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type askRequest struct {
	Question         string   `json:"question"`
	Language         string   `json:"language"`
	PublicLinkTokens []string `json:"publicLinkTokens"`
	// CategoryIDs narrow the search to documents in these categories.
	CategoryIDs []string `json:"categoryIds"`
	// ContextChatIDs are other chats of the User, brought in as background.
	ContextChatIDs []string `json:"contextChatIds"`
	// Attachments are text files for this question only.
	Attachments []struct {
		Name string `json:"name"`
		Text string `json:"text"`
	} `json:"attachments"`
}

// extras checks the categories, chats and files a question carries.
func (h *RAGChatHandler) extras(ctx context.Context, actorID, workspaceID, conversationID uuid.UUID, request askRequest) (model.QuestionExtras, error) {
	parse := func(raw []string) ([]uuid.UUID, error) {
		ids := make([]uuid.UUID, 0, len(raw))
		for _, text := range raw {
			id, err := uuid.Parse(text)
			if err != nil {
				return nil, appchat.ErrInvalidChatRequest
			}
			ids = append(ids, id)
		}
		return ids, nil
	}
	categories, err := parse(request.CategoryIDs)
	if err != nil {
		return model.QuestionExtras{}, err
	}
	chats, err := parse(request.ContextChatIDs)
	if err != nil {
		return model.QuestionExtras{}, err
	}
	files := make([]appchat.AttachmentInput, len(request.Attachments))
	for i, file := range request.Attachments {
		files[i] = appchat.AttachmentInput{Name: file.Name, Text: file.Text}
	}
	return h.service.PrepareExtras(ctx, workspaceID, actorID, conversationID, appchat.ExtrasInput{
		CategoryIDs: categories, ContextChatIDs: chats, Attachments: files,
	})
}

// Categories lists the categories the User may narrow a question to.
func (h *RAGChatHandler) Categories(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	categories, err := h.service.Categories(r.Context(), workspaceID, actorID)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, categories)
}

// answer asks the Agent when one is set up, otherwise answers from documents.
func (h *RAGChatHandler) answer(ctx context.Context, actorID, workspaceID, conversationID uuid.UUID, request askRequest, extras model.QuestionExtras) (any, error) {
	answered, err := h.answerQuestion(ctx, actorID, workspaceID, conversationID, request, extras)
	if err == nil {
		h.titleLater(actorID, workspaceID, conversationID, request.Language)
	}
	return answered, err
}

// titleLater has the model title the Conversation after its first answer, apart
// from the request so the answer is not held back. A spent Usage limit or a
// failed call leaves the title as the first question. It starts from a fresh
// context: the run's own context carries its output, which is closed once the
// run ends, and a late write to it would bring the server down.
func (h *RAGChatHandler) titleLater(actorID, workspaceID, conversationID uuid.UUID, language string) {
	go func() {
		background, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if h.checkLimit(background, actorID, workspaceID) != nil {
			return
		}
		_ = h.service.TitleConversation(background, workspaceID, conversationID, actorID, language)
	}()
}

func (h *RAGChatHandler) answerQuestion(ctx context.Context, actorID, workspaceID, conversationID uuid.UUID, request askRequest, extras model.QuestionExtras) (any, error) {
	if h.agent != nil && h.agent.ready(ctx) {
		answer, err := h.agent.chat.Ask(ctx, agent.ChatInput{
			WorkspaceID: workspaceID, ConversationID: conversationID, ActorID: actorID,
			Question: request.Question, Language: request.Language, Extras: extras,
		})
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"conversationId": answer.ConversationID, "text": answer.Text, "citations": []model.RAGCitation{},
			"coveragePartial": false, "sourcesMayBeIncomplete": false, "agent": true, "tools": answer.Tools, "actions": answer.Actions,
		}, nil
	}
	return h.service.Ask(ctx, appchat.AskInput{
		WorkspaceID: workspaceID, ConversationID: conversationID, ActorID: actorID,
		Question: request.Question, Language: request.Language, PublicLinkTokens: request.PublicLinkTokens, Extras: extras,
	})
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
	var request askRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.checkLimit(r.Context(), actorID, workspaceID); err != nil {
		writeRAGChatError(w, err)
		return
	}
	if h.runs == nil {
		resolved, err := h.service.ResolveMentions(r.Context(), workspaceID, actorID, strings.TrimSpace(request.Question))
		if err != nil {
			writeRAGChatError(w, err)
			return
		}
		request.Question = resolved
		extras, err := h.extras(r.Context(), actorID, workspaceID, conversationID, request)
		if err != nil {
			writeRAGChatError(w, err)
			return
		}
		answer, err := h.answer(r.Context(), actorID, workspaceID, conversationID, request, extras)
		if err != nil {
			writeRAGChatError(w, err)
			return
		}
		_ = response.Data(w, http.StatusOK, answer)
		return
	}
	// The older JSON endpoint runs the same job as the stream, so the work keeps
	// going on the server when the caller leaves, and waits for the whole answer.
	run, _, err := h.startRun(r, actorID, workspaceID, conversationID, request)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	finished, workErr, err := h.runs.Wait(r.Context(), actorID, run.ID)
	if err != nil {
		if r.Context().Err() == nil {
			writeRAGChatError(w, err)
		}
		return
	}
	switch {
	case workErr != nil:
		writeRAGChatError(w, workErr)
	case finished.Status == "completed":
		_ = response.Data(w, http.StatusOK, finished.Result)
	default:
		response.Error(w, http.StatusServiceUnavailable, "chat model provider is temporarily unavailable")
	}
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
	case errors.Is(err, aiusage.ErrLimitReached):
		response.ErrorWithCode(w, http.StatusTooManyRequests, "ai_limit_reached", "this month's AI usage limit is spent")
	case errors.Is(err, appchat.ErrTooManyMentions):
		response.Error(w, http.StatusBadRequest, "mention at most 5 documents in one question")
	case errors.Is(err, appchat.ErrMentionUnavailable):
		response.Error(w, http.StatusBadRequest, "a mentioned document is not available to you in this workspace")
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
	case errors.Is(err, constant.ErrConversationPinLimit):
		response.Error(w, http.StatusConflict, "you can pin at most 5 conversations here; unpin one first")
	case errors.Is(err, appchat.ErrAnswerModelUnavailable):
		response.Error(w, http.StatusServiceUnavailable, "chat model is not configured")
	case errors.Is(err, airuns.ErrBusy):
		response.Error(w, http.StatusConflict, "an answer is already being written in this conversation")
	case errors.Is(err, airuns.ErrCapacity):
		response.Error(w, http.StatusServiceUnavailable, "too many answers are being written; try again shortly")
	case errors.Is(err, airuns.ErrConflict):
		response.Error(w, http.StatusUnprocessableEntity, "this Idempotency-Key was used for a different question")
	case errors.Is(err, airuns.ErrNotFound):
		response.Error(w, http.StatusNotFound, "AI run not found")
	case errors.Is(err, context.DeadlineExceeded):
		response.Error(w, http.StatusServiceUnavailable, "chat model provider is temporarily unavailable")
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

// SearchDocuments lists documents by title for the @ picker of a question.
func (h *RAGChatHandler) SearchDocuments(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	limit := 8
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if limit, err = strconv.Atoi(raw); err != nil || limit < 1 {
			response.Error(w, http.StatusBadRequest, "invalid limit")
			return
		}
	}
	hits, err := h.service.SearchDocuments(r.Context(), workspaceID, actorID, r.URL.Query().Get("search"), limit)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, hits)
}
