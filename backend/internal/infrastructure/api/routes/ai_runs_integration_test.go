//go:build integration

package routes

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"backend/internal/application/agent"
	"backend/internal/application/airuns"
)

// gatedAgent writes its answer in two parts and waits between them, so a test can
// look at the run while the provider is still working.
type gatedAgent struct {
	mu        sync.Mutex
	calls     int
	firstSent chan struct{}
	release   chan struct{}
	stopped   chan struct{}
}

func newGatedAgent() *gatedAgent {
	return &gatedAgent{firstSent: make(chan struct{}, 4), release: make(chan struct{}), stopped: make(chan struct{}, 4)}
}

func (g *gatedAgent) AgentReady(context.Context) bool { return true }

func (g *gatedAgent) Step(ctx context.Context, _ []agent.Message, _ []agent.ToolSpec) (agent.Message, error) {
	g.mu.Lock()
	g.calls++
	g.mu.Unlock()
	if err := airuns.Emit(ctx, "text_delta", map[string]string{"text": "Halo "}); err != nil {
		return agent.Message{}, err
	}
	g.firstSent <- struct{}{}
	select {
	case <-g.release:
	case <-ctx.Done():
		g.stopped <- struct{}{}
		return agent.Message{}, ctx.Err()
	}
	if err := airuns.Emit(ctx, "text_delta", map[string]string{"text": "dunia"}); err != nil {
		return agent.Message{}, err
	}
	return agent.Message{Role: "assistant", Content: "Halo dunia"}, nil
}

type runEnv struct {
	*agentEnv
	gate   *gatedAgent
	server *httptest.Server
	conv   string
}

func newRunEnv(t *testing.T) *runEnv {
	t.Helper()
	e := newAgentEnv(t)
	gate := newGatedAgent()
	e.app.AgentModel = gate
	e.api = InitRoutes(e.app, e.cfg)
	server := httptest.NewServer(e.api)
	t.Cleanup(server.Close)
	r := &runEnv{agentEnv: e, gate: gate, server: server}
	res := e.do(http.MethodPost, "/api/v1/rag/conversations", map[string]any{"documentId": e.doc}, r.headers(e.owner, ""), "")
	var conv struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	res.json(&conv)
	if res.Code != http.StatusCreated {
		t.Fatalf("create conversation = %d %s", res.Code, res.Body.String())
	}
	r.conv = conv.Data.ID
	return r
}

func (r *runEnv) headers(u tokenUser, key string) map[string]string {
	h := map[string]string{"Authorization": "Bearer " + u.token, "X-Workspace-Id": r.ws}
	if key != "" {
		h["Idempotency-Key"] = key
	}
	return h
}

type runBody struct {
	Data struct {
		ID       string `json:"id"`
		Status   string `json:"status"`
		Draft    string `json:"draft"`
		Sequence int64  `json:"sequence"`
	} `json:"data"`
}

func (r *runEnv) start(key, question string) (int, runBody) {
	r.t.Helper()
	res := r.do(http.MethodPost, "/api/v1/rag/conversations/"+r.conv+"/runs", map[string]any{"question": question, "language": "id"}, r.headers(r.owner, key), "")
	var body runBody
	res.json(&body)
	return res.Code, body
}

func (r *runEnv) snapshot(u tokenUser, id string) (int, runBody) {
	res := r.do(http.MethodGet, "/api/v1/ai/runs/"+id, nil, r.headers(u, ""), "")
	var body runBody
	res.json(&body)
	return res.Code, body
}

type sseEvent struct {
	ID   int64
	Type string
	Data json.RawMessage
}

// follow reads the run's event stream until stop returns true or the stream ends.
func (r *runEnv) follow(u tokenUser, id string, lastID int64, stop func(sseEvent) bool) []sseEvent {
	r.t.Helper()
	req, _ := http.NewRequest(http.MethodGet, r.server.URL+"/api/v1/ai/runs/"+id+"/events", nil)
	req.Header.Set("Authorization", "Bearer "+u.token)
	if lastID > 0 {
		req.Header.Set("Last-Event-ID", strconv.FormatInt(lastID, 10))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	res, err := http.DefaultClient.Do(req.WithContext(ctx))
	if err != nil {
		r.t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		r.t.Fatalf("events = %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	var events []sseEvent
	var current sseEvent
	scanner := bufio.NewScanner(res.Body)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "id: "):
			current.ID, _ = strconv.ParseInt(strings.TrimPrefix(line, "id: "), 10, 64)
		case strings.HasPrefix(line, "event: "):
			current.Type = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			current.Data = json.RawMessage(strings.TrimPrefix(line, "data: "))
		case line == "" && current.Type != "":
			events = append(events, current)
			if stop(current) {
				return events
			}
			current = sseEvent{}
		}
	}
	return events
}

func deltaText(events []sseEvent) string {
	var text strings.Builder
	for _, e := range events {
		if e.Type == "text_delta" {
			var d struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal(e.Data, &d)
			text.WriteString(d.Text)
		}
	}
	return text.String()
}

func (r *runEnv) messages() int {
	res := r.do(http.MethodGet, "/api/v1/rag/conversations/"+r.conv, nil, r.headers(r.owner, ""), "")
	var h struct {
		Data struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		} `json:"data"`
	}
	res.json(&h)
	return len(h.Data.Messages)
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestRunTextArrivesBeforeTheProviderFinishesAndReconnectDoesNotRepeatIt(t *testing.T) {
	e := newRunEnv(t)
	code, run := e.start("k1", "Sapa saya")
	if code != http.StatusAccepted || run.Data.Status != "running" {
		t.Fatalf("start = %d %+v", code, run)
	}
	<-e.gate.firstSent

	first := e.follow(e.owner, run.Data.ID, 0, func(ev sseEvent) bool { return ev.Type == "text_delta" })
	if got := deltaText(first); got != "Halo " {
		t.Fatalf("text before the provider finished = %q", got)
	}
	if e.messages() != 0 {
		t.Fatal("a draft was stored as a chat message")
	}
	_, mid := e.snapshot(e.owner, run.Data.ID)
	if mid.Data.Status != "running" || mid.Data.Draft != "Halo " {
		t.Fatalf("snapshot while running = %+v", mid.Data)
	}

	cursor := first[len(first)-1].ID
	close(e.gate.release)
	rest := e.follow(e.owner, run.Data.ID, cursor, func(ev sseEvent) bool { return ev.Type == "completed" })
	for _, ev := range rest {
		if ev.ID <= cursor {
			t.Fatalf("event %d was sent again after cursor %d", ev.ID, cursor)
		}
	}
	if got := deltaText(rest); got != "dunia" {
		t.Fatalf("text after reconnect = %q", got)
	}
	if code, done := e.snapshot(e.owner, run.Data.ID); code != 200 || done.Data.Status != "completed" {
		t.Fatalf("final snapshot = %d %+v", code, done.Data)
	}
	if n := e.messages(); n != 2 {
		t.Fatalf("messages = %d, want the question and one answer", n)
	}
	// Following a finished run replays it to the end, with the same single answer.
	again := e.follow(e.owner, run.Data.ID, 0, func(ev sseEvent) bool { return ev.Type == "completed" })
	if deltaText(again) != "Halo dunia" || e.messages() != 2 {
		t.Fatalf("replay = %q, messages %d", deltaText(again), e.messages())
	}
}

func TestRunIsIdempotentAndAConversationHasOneActiveRun(t *testing.T) {
	e := newRunEnv(t)
	_, run := e.start("same", "Pertanyaan satu")
	<-e.gate.firstSent
	code, again := e.start("same", "Pertanyaan satu")
	if code != http.StatusAccepted || again.Data.ID != run.Data.ID {
		t.Fatalf("repeated start = %d %+v, want the same run %s", code, again.Data, run.Data.ID)
	}
	if code, _ := e.start("same", "Pertanyaan lain"); code != http.StatusUnprocessableEntity {
		t.Fatalf("same key, other question = %d, want 422", code)
	}
	if code, _ := e.start("other", "Pertanyaan dua"); code != http.StatusConflict {
		t.Fatalf("second active run = %d, want 409", code)
	}
	legacy := e.do(http.MethodPost, "/api/v1/rag/conversations/"+e.conv+"/messages", map[string]any{"question": "lewat jalur lama"}, e.headers(e.owner, ""), "")
	if legacy.Code != http.StatusConflict {
		t.Fatalf("JSON endpoint during an active run = %d, want 409", legacy.Code)
	}
	if e.gate.calls != 1 {
		t.Fatalf("model ran %d times, want 1", e.gate.calls)
	}
	close(e.gate.release)
	waitFor(t, "completion", func() bool { _, s := e.snapshot(e.owner, run.Data.ID); return s.Data.Status == "completed" })
	latest := e.do(http.MethodGet, "/api/v1/rag/conversations/"+e.conv+"/runs", nil, e.headers(e.owner, ""), "")
	var l runBody
	latest.json(&l)
	if latest.Code != 200 || l.Data.ID != run.Data.ID {
		t.Fatalf("latest run = %d %s", latest.Code, latest.Body.String())
	}
}

func TestOnlyTheOwnerCanSeeOrStopARun(t *testing.T) {
	e := newRunEnv(t)
	_, run := e.start("k", "Rahasia")
	<-e.gate.firstSent
	other := e.registerWithToken("")
	if code, _ := e.snapshot(other, run.Data.ID); code != http.StatusNotFound {
		t.Fatalf("other user's snapshot = %d, want 404", code)
	}
	res := e.do(http.MethodGet, "/api/v1/ai/runs/"+run.Data.ID+"/events", nil, e.headers(other, ""), "")
	if res.Code != http.StatusNotFound || strings.Contains(res.Body.String(), "Halo") {
		t.Fatalf("other user's events = %d %s", res.Code, res.Body.String())
	}
	if res := e.do(http.MethodPost, "/api/v1/ai/runs/"+run.Data.ID+"/cancel", nil, e.headers(other, ""), ""); res.Code != http.StatusNotFound {
		t.Fatalf("other user's cancel = %d, want 404", res.Code)
	}
	if _, s := e.snapshot(e.owner, run.Data.ID); s.Data.Status != "running" {
		t.Fatalf("run status after the refused cancel = %s", s.Data.Status)
	}
	close(e.gate.release)
}

func TestStopCancelsTheModelAndStoresNoAnswer(t *testing.T) {
	e := newRunEnv(t)
	_, run := e.start("stop", "Panjang sekali")
	<-e.gate.firstSent
	res := e.do(http.MethodPost, "/api/v1/ai/runs/"+run.Data.ID+"/cancel", nil, e.headers(e.owner, ""), "")
	var stopped runBody
	res.json(&stopped)
	if res.Code != http.StatusOK || stopped.Data.Status != "cancelled" {
		t.Fatalf("cancel = %d %s", res.Code, res.Body.String())
	}
	select {
	case <-e.gate.stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("the model call was not cancelled")
	}
	events := e.follow(e.owner, run.Data.ID, 0, func(ev sseEvent) bool { return ev.Type == "cancelled" })
	if len(events) == 0 || events[len(events)-1].Type != "cancelled" {
		t.Fatalf("events = %+v", events)
	}
	if e.messages() != 0 {
		t.Fatal("a stopped answer was stored as a chat message")
	}
	if code, _ := e.start("after-stop", "Tanya lagi"); code != http.StatusAccepted {
		t.Fatalf("a new question after Stop = %d, want 202", code)
	}
	close(e.gate.release)
}

func TestClosingTheEventStreamDoesNotStopTheRun(t *testing.T) {
	e := newRunEnv(t)
	_, run := e.start("watch", "Tetap jalan")
	<-e.gate.firstSent
	e.follow(e.owner, run.Data.ID, 0, func(ev sseEvent) bool { return ev.Type == "text_delta" })
	close(e.gate.release)
	waitFor(t, "the run to finish with nobody watching", func() bool {
		_, s := e.snapshot(e.owner, run.Data.ID)
		return s.Data.Status == "completed"
	})
	if e.messages() != 2 {
		t.Fatalf("messages = %d, want 2", e.messages())
	}
}

func TestDeletingAConversationStopsItsRunAndStoresNoAnswer(t *testing.T) {
	e := newRunEnv(t)
	_, run := e.start("delete", "Akan dihapus")
	<-e.gate.firstSent
	res := e.do(http.MethodDelete, "/api/v1/rag/conversations/"+e.conv, nil, e.headers(e.owner, ""), "")
	if res.Code != http.StatusNoContent {
		t.Fatalf("delete conversation = %d %s", res.Code, res.Body.String())
	}
	select {
	case <-e.gate.stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("the model call kept going after its conversation was deleted")
	}
	var messages int
	_ = e.db.QueryRow(`SELECT COUNT(*) FROM rag_messages WHERE conversation_id = $1`, e.conv).Scan(&messages)
	if messages != 0 {
		t.Fatalf("messages stored for a deleted conversation = %d", messages)
	}
	if code, _ := e.snapshot(e.owner, run.Data.ID); code != http.StatusNotFound {
		t.Fatalf("run of a deleted conversation = %d, want it gone with the conversation", code)
	}
}

func TestStoppingTheServerMarksARunInterruptedAndDoesNotFinishIt(t *testing.T) {
	e := newRunEnv(t)
	_, run := e.start("shutdown", "Server berhenti")
	<-e.gate.firstSent
	e.app.AIRuns.Close()
	waitFor(t, "the run to be marked interrupted", func() bool {
		var status string
		_ = e.db.QueryRow(`SELECT status FROM ai_runs WHERE id = $1`, run.Data.ID).Scan(&status)
		return status == "interrupted"
	})
	if e.messages() != 0 {
		t.Fatal("an interrupted run stored an answer")
	}
	var draft string
	_ = e.db.QueryRow(`SELECT draft FROM ai_runs WHERE id = $1`, run.Data.ID).Scan(&draft)
	if draft != "Halo " {
		t.Fatalf("draft kept after the interruption = %q, want what had been shown", draft)
	}
}
