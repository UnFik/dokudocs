package aiprovider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	agentapp "backend/internal/application/agent"
	"backend/internal/application/airuns"
	app "backend/internal/application/aisettings"
	"backend/internal/application/aiusage"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type plainCipher struct{}

func (plainCipher) Seal(s string) ([]byte, error) { return []byte(s), nil }
func (plainCipher) Open(b []byte) (string, error) { return string(b), nil }

type memReader struct {
	mu      sync.Mutex
	rows    map[string]app.Record
	gets    int
	errors  []string
	cleared int
}

func (m *memReader) Get(_ context.Context, purpose string) (app.Record, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.gets++
	r, ok := m.rows[purpose]
	return r, ok, nil
}
func (m *memReader) RecordError(_ context.Context, purpose, message string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.errors = append(m.errors, purpose+": "+message)
	r := m.rows[purpose]
	r.LastError = message
	m.rows[purpose] = r
	return nil
}
func (m *memReader) ClearError(_ context.Context, purpose string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.cleared++
	r := m.rows[purpose]
	r.LastError = ""
	m.rows[purpose] = r
	return nil
}

func chatServer(t *testing.T, status int, answer string, hits *int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if hits != nil {
			*hits++
		}
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": answer}}}})
		_, _ = w.Write(body)
	}))
}

func record(purpose, url, model string) app.Record {
	return app.Record{Purpose: purpose, BaseURL: url, Protocol: app.ProtocolChatCompletions, Model: model,
		APIKeyCiphertext: []byte("sk-test-key"), UpdatedAt: time.Now()}
}

func input() appchat.ModelInput {
	return appchat.ModelInput{Question: "q", Language: "en", Sources: []model.RAGChunk{{ChunkID: uuid.New(), Text: "t"}}}
}

func TestTheTesterAcceptsAWorkingAnswerProvider(t *testing.T) {
	server := chatServer(t, http.StatusOK, `{"answer":"ok","source_ids":[]}`, nil)
	defer server.Close()
	_, err := NewTester(true).Test(context.Background(), app.PurposeAnswer,
		app.Config{BaseURL: server.URL, Protocol: app.ProtocolChatCompletions, Model: "m", APIKey: "sk-test-key"})
	if err != nil {
		t.Fatalf("Test(): %v", err)
	}
}

func TestTheTesterSaysWhatWentWrongWithoutRepeatingTheKey(t *testing.T) {
	server := chatServer(t, http.StatusUnauthorized, "", nil)
	defer server.Close()
	_, err := NewTester(true).Test(context.Background(), app.PurposeAnswer,
		app.Config{BaseURL: server.URL, Protocol: app.ProtocolChatCompletions, Model: "m", APIKey: "sk-test-key"})
	if err == nil || !strings.Contains(err.Error(), "401") || strings.Contains(err.Error(), "sk-test-key") {
		t.Fatalf("Test() error = %v, want a message naming HTTP 401 and no key", err)
	}
	server.Close()
	_, err = NewTester(true).Test(context.Background(), app.PurposeAnswer,
		app.Config{BaseURL: server.URL, Protocol: app.ProtocolChatCompletions, Model: "m", APIKey: "sk-test-key"})
	if err == nil || strings.Contains(err.Error(), "sk-test-key") {
		t.Fatalf("Test() against a closed server = %v", err)
	}
}

func TestTheTesterRejectsAnEmbeddingModelOfAnotherSize(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"index": 0, "embedding": make([]float32, 768)}}})
	}))
	defer server.Close()
	_, err := NewTester(true).Test(context.Background(), app.PurposeEmbedding,
		app.Config{BaseURL: server.URL, Protocol: app.ProtocolResponses, Model: "small", APIKey: "k"})
	if err == nil || !strings.Contains(err.Error(), "768") || !strings.Contains(err.Error(), "1536") {
		t.Fatalf("Test() error = %v, want the two sizes named", err)
	}
}

func TestTheResolverAnswersWithTheStoredSettingAndSeesAChangeAfterTheCacheExpires(t *testing.T) {
	var firstHits, secondHits int
	first := chatServer(t, http.StatusOK, `{"answer":"from first","source_ids":[]}`, &firstHits)
	defer first.Close()
	second := chatServer(t, http.StatusOK, `{"answer":"from second","source_ids":[]}`, &secondHits)
	defer second.Close()
	reader := &memReader{rows: map[string]app.Record{app.PurposeAnswer: record(app.PurposeAnswer, first.URL, "m")}}
	now := time.Now()
	resolver := NewResolver(reader, plainCipher{}, true)
	resolver.now = func() time.Time { return now }

	out, err := resolver.Answer(context.Background(), input())
	if err != nil || out.Text != "from first" {
		t.Fatalf("Answer() = %+v, %v", out, err)
	}
	reader.rows[app.PurposeAnswer] = record(app.PurposeAnswer, second.URL, "m")
	now = now.Add(10 * time.Second)
	if out, _ := resolver.Answer(context.Background(), input()); out.Text != "from first" {
		t.Fatalf("the change showed up before the cache expired: %q", out.Text)
	}
	now = now.Add(30 * time.Second)
	if out, _ := resolver.Answer(context.Background(), input()); out.Text != "from second" {
		t.Fatalf("the change did not show up after the cache expired: %q", out.Text)
	}
	resolver.Invalidate()
	reader.rows[app.PurposeAnswer] = record(app.PurposeAnswer, first.URL, "m")
	if out, _ := resolver.Answer(context.Background(), input()); out.Text != "from first" {
		t.Fatalf("Invalidate() did not force a re-read: %q", out.Text)
	}
}

func TestWithoutASettingTheAnswerIsUnavailableAndEmbeddingIsNotConfigured(t *testing.T) {
	resolver := NewResolver(&memReader{rows: map[string]app.Record{}}, plainCipher{}, true)
	if _, err := resolver.Answer(context.Background(), input()); !errors.Is(err, appchat.ErrAnswerModelUnavailable) {
		t.Fatalf("Answer() error = %v, want ErrAnswerModelUnavailable", err)
	}
	if _, err := resolver.Embedder(app.PurposeEmbedding).Embed(context.Background(), []string{"x"}); !errors.Is(err, appchat.ErrEmbeddingNotConfigured) {
		t.Fatalf("Embed() error = %v, want ErrEmbeddingNotConfigured", err)
	}
}

func TestAProviderFailureIsRecordedAndASuccessClearsIt(t *testing.T) {
	status := http.StatusInternalServerError
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}
		body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `{"answer":"ok","source_ids":[]}`}}}})
		_, _ = w.Write(body)
	}))
	defer server.Close()
	reader := &memReader{rows: map[string]app.Record{app.PurposeAnswer: record(app.PurposeAnswer, server.URL, "m")}}
	now := time.Now()
	resolver := NewResolver(reader, plainCipher{}, true)
	resolver.now = func() time.Time { return now }

	if _, err := resolver.Answer(context.Background(), input()); !errors.Is(err, appchat.ErrRAGProviderUnavailable) {
		t.Fatalf("Answer() error = %v", err)
	}
	if len(reader.errors) != 1 || !strings.Contains(reader.errors[0], "500") {
		t.Fatalf("recorded errors = %v", reader.errors)
	}
	status = http.StatusOK
	now = now.Add(time.Minute)
	if _, err := resolver.Answer(context.Background(), input()); err != nil {
		t.Fatalf("Answer(): %v", err)
	}
	if reader.cleared != 1 {
		t.Fatalf("the stored error was cleared %d times, want 1", reader.cleared)
	}
}

func TestEmbedderSnapshotsAreFixedToOneModel(t *testing.T) {
	reader := &memReader{rows: map[string]app.Record{
		app.PurposeEmbedding:        record(app.PurposeEmbedding, "https://api.openai.com/v1", "active-model"),
		app.PurposeEmbeddingPending: record(app.PurposeEmbeddingPending, "https://emb.example.com/v1", "pending-model"),
	}}
	resolver := NewResolver(reader, plainCipher{}, false)
	active, ok, err := resolver.Snapshot(context.Background(), app.PurposeEmbedding)
	if err != nil || !ok || active.Provider() != "openai" || active.Model() != "active-model" {
		t.Fatalf("active snapshot = %v %v %v", active, ok, err)
	}
	pending, ok, err := resolver.Snapshot(context.Background(), app.PurposeEmbeddingPending)
	if err != nil || !ok || pending.Provider() != "emb.example.com" || pending.Model() != "pending-model" {
		t.Fatalf("pending snapshot = %v %v %v", pending, ok, err)
	}
	if view := resolver.Embedder(app.PurposeEmbedding); view.Provider() != "openai" || view.Model() != "active-model" || view.Dimensions() != 1536 {
		t.Fatalf("the active view reports %s/%s", view.Provider(), view.Model())
	}
	if _, ok, _ := resolver.Snapshot(context.Background(), "nothing"); ok {
		t.Fatal("a purpose without a row has a snapshot")
	}
}

type usageMem struct {
	mu      sync.Mutex
	records []aiusage.Record
}

func (u *usageMem) RecordUsage(_ context.Context, r aiusage.Record) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.records = append(u.records, r)
	return nil
}
func (u *usageMem) UsageSummary(context.Context, time.Time, int) (aiusage.Summary, error) {
	return aiusage.Summary{}, nil
}

func TestTheAgentModelComesFromItsSettingAndCountsUsageForTheUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": "done"}}},
			"usage":   map[string]any{"prompt_tokens": 11, "completion_tokens": 2},
		})
	}))
	defer server.Close()
	reader := &memReader{rows: map[string]app.Record{}}
	usage := &usageMem{}
	resolver := NewResolver(reader, plainCipher{}, true).WithUsage(usage)
	if resolver.AgentReady(context.Background()) {
		t.Fatal("an agent is ready without a setting")
	}
	if _, err := resolver.Step(context.Background(), nil, nil); !errors.Is(err, agentapp.ErrAgentNotConfigured) {
		t.Fatalf("Step() without a setting = %v", err)
	}
	reader.rows[app.PurposeAgent] = record(app.PurposeAgent, server.URL, "agent-m")
	resolver.Invalidate()
	user, workspace := uuid.New(), uuid.New()
	ctx := aiusage.With(context.Background(), aiusage.Attribution{Feature: aiusage.FeatureChatDocument, UserID: user, WorkspaceID: workspace})
	reply, err := resolver.Step(ctx, []agentapp.Message{{Role: "user", Content: "hi"}}, nil)
	if err != nil || reply.Content != "done" || !resolver.AgentReady(ctx) {
		t.Fatalf("Step() = %+v, %v", reply, err)
	}
	if len(usage.records) != 1 {
		t.Fatalf("usage = %+v", usage.records)
	}
	got := usage.records[0]
	if got.Purpose != app.PurposeAgent || got.Model != "agent-m" || got.Feature != aiusage.FeatureChatDocument || got.UserID != user || got.WorkspaceID != workspace || got.InputTokens != 11 || !got.OK {
		t.Fatalf("usage record = %+v", got)
	}
}

func TestTheTesterRequiresTheAgentModelToCallATool(t *testing.T) {
	calls := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		message := map[string]any{"content": "pong"}
		if calls {
			message["tool_calls"] = []any{map[string]any{"id": "c", "type": "function", "function": map[string]any{"name": "ping", "arguments": "{}"}}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message}}})
	}))
	defer server.Close()
	cfg := app.Config{BaseURL: server.URL, Protocol: app.ProtocolChatCompletions, Model: "m", APIKey: "k"}
	if _, err := NewTester(true).Test(context.Background(), app.PurposeAgent, cfg); err == nil || !strings.Contains(err.Error(), "tool") {
		t.Fatalf("a model that answers without calling a tool passed: %v", err)
	}
	calls = true
	if _, err := NewTester(true).Test(context.Background(), app.PurposeAgent, cfg); err != nil {
		t.Fatalf("Test(): %v", err)
	}
}

func streamingServer(t *testing.T, sse bool) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		if sse && request["stream"] == true {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"{\\\"answer\\\":\\\"ok\\\",\\\"source_ids\\\":[]}\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
			return
		}
		body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `{"answer":"ok","source_ids":[]}`}}}})
		_, _ = w.Write(body)
	}))
}

func TestTheTesterReportsWhetherTheProviderStreams(t *testing.T) {
	cases := map[string]struct {
		sse   bool
		inRun bool
		want  string
	}{
		"event stream in a run": {sse: true, inRun: true, want: "supported"},
		"whole answer in a run": {sse: false, inRun: true, want: "unsupported"},
		"outside a run":         {sse: true, inRun: false, want: "unverified"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			server := streamingServer(t, c.sse)
			defer server.Close()
			ctx := context.Background()
			if c.inRun {
				ctx = airuns.WithOutput(ctx, func(airuns.Event) error { return nil })
			}
			report, err := NewTester(true).Test(ctx, app.PurposeAnswer,
				app.Config{BaseURL: server.URL, Protocol: app.ProtocolChatCompletions, Model: "m", APIKey: "sk-test-key"})
			if err != nil || report.Streaming != c.want {
				t.Fatalf("Test() = %+v, %v; want streaming %q", report, err, c.want)
			}
		})
	}
}
