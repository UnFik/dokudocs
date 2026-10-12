package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"backend/internal/application/airuns"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/presentation/response"
	"backend/internal/presentation/sse"

	"github.com/google/uuid"
)

const (
	runPollInterval = 150 * time.Millisecond
	runHeartbeat    = 15 * time.Second
)

// startRun starts the conversation's answer as a run, or returns the run an
// earlier request with the same Idempotency-Key already started.
func (h *RAGChatHandler) startRun(r *http.Request, actorID, workspaceID, conversationID uuid.UUID, request askRequest) (airuns.Run, bool, error) {
	question := strings.TrimSpace(request.Question)
	if question == "" || len(question) > 10000 || len(request.PublicLinkTokens) > 20 {
		return airuns.Run{}, false, appchat.ErrInvalidChatRequest
	}
	if err := h.service.Authorize(r.Context(), workspaceID, conversationID, actorID); err != nil {
		return airuns.Run{}, false, err
	}
	if err := h.checkLimit(r.Context(), actorID, workspaceID); err != nil {
		return airuns.Run{}, false, err
	}
	resolved, err := h.service.ResolveMentions(r.Context(), workspaceID, actorID, question)
	if err != nil {
		return airuns.Run{}, false, err
	}
	request.Question = resolved
	extras, err := h.extras(r.Context(), actorID, workspaceID, conversationID, request)
	if err != nil {
		return airuns.Run{}, false, err
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" {
		key = uuid.NewString()
	}
	sum := sha256.New()
	_, _ = fmt.Fprintf(sum, "%s\x00%s\x00%s\x00%s", conversationID, request.Question, request.Language, strings.Join(request.PublicLinkTokens, "\x00"))
	// A retry with other categories, chats or files is a different question.
	_, _ = fmt.Fprintf(sum, "\x00%v\x00%v", extras.CategoryIDs, request.ContextChatIDs)
	for _, file := range extras.Attachments {
		_, _ = fmt.Fprintf(sum, "\x00%s\x00%s", file.Name, file.Text)
	}
	return h.runs.Start(r.Context(), airuns.Start{
		OwnerID: actorID, WorkspaceID: &workspaceID, ConversationID: &conversationID, Kind: "chat",
		IdempotencyKey: key, Fingerprint: hex.EncodeToString(sum.Sum(nil)), Deadline: time.Now().Add(h.timeout),
	}, func(ctx context.Context) (json.RawMessage, error) {
		answer, err := h.answer(ctx, actorID, workspaceID, conversationID, request, extras)
		if err != nil {
			return nil, err
		}
		return json.Marshal(answer)
	})
}

// StartRun begins an answer and returns at once with the run to follow.
func (h *RAGChatHandler) StartRun(w http.ResponseWriter, r *http.Request) {
	actorID, workspaceID, err := getUserAndWorkspace(r)
	if err != nil {
		writeDocumentError(w, err)
		return
	}
	conversationID, err := parsePathUUID(r, "conversationID")
	if err != nil || h.runs == nil {
		response.Error(w, http.StatusBadRequest, "invalid conversation ID")
		return
	}
	var request askRequest
	if err := response.DecodeJSON(r, &request); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	run, _, err := h.startRun(r, actorID, workspaceID, conversationID, request)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusAccepted, run)
}

// LatestRun is the run in progress on a conversation, or else its last one.
func (h *RAGChatHandler) LatestRun(w http.ResponseWriter, r *http.Request) {
	actorID, err := authenticatedRAGUserID(r)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	conversationID, err := parsePathUUID(r, "conversationID")
	if err != nil || h.runs == nil {
		response.Error(w, http.StatusBadRequest, "invalid conversation ID")
		return
	}
	run, err := h.runs.Latest(r.Context(), actorID, conversationID)
	if errors.Is(err, airuns.ErrNotFound) {
		_ = response.Data(w, http.StatusOK, nil)
		return
	}
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, run)
}

// RunHandler serves any AI run to its owner.
type RunHandler struct{ runs *airuns.Service }

func NewRunHandler(runs *airuns.Service) *RunHandler { return &RunHandler{runs: runs} }

func (h *RunHandler) ids(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	owner, err := authenticatedRAGUserID(r)
	if err != nil {
		writeRAGChatError(w, err)
		return uuid.Nil, uuid.Nil, false
	}
	id, err := parsePathUUID(r, "runID")
	if err != nil {
		response.Error(w, http.StatusBadRequest, "invalid run ID")
		return uuid.Nil, uuid.Nil, false
	}
	return owner, id, true
}

func (h *RunHandler) Get(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	run, err := h.runs.Get(r.Context(), owner, id)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, run)
}

func (h *RunHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	run, err := h.runs.Cancel(r.Context(), owner, id)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	_ = response.Data(w, http.StatusOK, run)
}

func isTerminalRunEvent(kind string) bool {
	switch kind {
	case "completed", "failed", "cancelled", "interrupted":
		return true
	}
	return false
}

// Events follows a run as server-sent events. The cursor is the sequence of the
// last event the client has, from Last-Event-ID or ?after=. Closing the stream
// only stops watching; the run goes on.
func (h *RunHandler) Events(w http.ResponseWriter, r *http.Request) {
	owner, id, ok := h.ids(w, r)
	if !ok {
		return
	}
	cursor := r.Header.Get("Last-Event-ID")
	if cursor == "" {
		cursor = r.URL.Query().Get("after")
	}
	after, _ := strconv.ParseInt(cursor, 10, 64)
	if after < 0 {
		after = 0
	}
	run, err := h.runs.Get(r.Context(), owner, id)
	if err != nil {
		writeRAGChatError(w, err)
		return
	}
	stream := sse.Open(w)
	if after > run.Sequence {
		// The client's cursor is from a run that no longer has those events.
		snapshot, _ := json.Marshal(run)
		if !stream.Event(strconv.FormatInt(run.Sequence, 10), "snapshot", snapshot) {
			return
		}
		after = run.Sequence
	}
	poll := time.NewTicker(runPollInterval)
	defer poll.Stop()
	lastWrite := time.Now()
	for {
		events, err := h.runs.Events(r.Context(), owner, id, after)
		if err != nil {
			return
		}
		for _, event := range events {
			var data bytes.Buffer
			if json.Compact(&data, event.Data) != nil {
				return
			}
			if !stream.Event(strconv.FormatInt(event.Sequence, 10), event.Type, data.Bytes()) {
				return
			}
			lastWrite = time.Now()
			after = event.Sequence
			if isTerminalRunEvent(event.Type) {
				return
			}
		}
		if len(events) == 256 {
			continue
		}
		if time.Since(lastWrite) > runHeartbeat {
			if !stream.Heartbeat() {
				return
			}
			lastWrite = time.Now()
		}
		select {
		case <-r.Context().Done():
			return
		case <-h.runs.Done():
			return
		case <-poll.C:
		}
	}
}
