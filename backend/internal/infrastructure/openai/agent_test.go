package openai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"backend/internal/application/agent"
	appchat "backend/internal/application/rag/usecase"
)

var specs = []agent.ToolSpec{{Name: "read_document", Description: "Read a document.", Parameters: map[string]any{"type": "object", "properties": map[string]any{}}}}

func conversation() []agent.Message {
	return []agent.Message{
		{Role: "system", Content: "Be useful."},
		{Role: "user", Content: "What does the spec say?"},
		{Role: "assistant", ToolCalls: []agent.ToolCall{{ID: "c1", Name: "read_document", Arguments: json.RawMessage(`{"document_id":"d"}`)}}},
		{Role: "tool", ToolCallID: "c1", Content: `{"data":"It says hello."}`},
	}
}

func TestChatCompletionsAgentSendsToolsAndReadsToolCalls(t *testing.T) {
	var sent struct {
		Model    string           `json:"model"`
		Messages []map[string]any `json:"messages"`
		Tools    []map[string]any `json:"tools"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			w.WriteHeader(404)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&sent)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{
				"content":    "",
				"tool_calls": []any{map[string]any{"id": "c2", "type": "function", "function": map[string]any{"name": "read_document", "arguments": `{"document_id":"e"}`}}},
			}}},
			"usage": map[string]any{"prompt_tokens": 120, "completion_tokens": 7},
		})
	}))
	defer server.Close()
	var usage [2]int
	model := NewAgent(Config{BaseURL: server.URL + "/v1", APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions, AllowPrivate: true,
		OnUsage: func(_ context.Context, in, out int, _ time.Duration, ok bool) { usage = [2]int{in, out} }})
	reply, err := model.Step(context.Background(), conversation(), specs)
	if err != nil || len(reply.ToolCalls) != 1 || reply.ToolCalls[0].ID != "c2" || string(reply.ToolCalls[0].Arguments) != `{"document_id":"e"}` {
		t.Fatalf("Step() = %+v, %v", reply, err)
	}
	if len(sent.Tools) != 1 || sent.Tools[0]["type"] != "function" || len(sent.Messages) != 4 || sent.Messages[3]["tool_call_id"] != "c1" {
		t.Fatalf("request tools %v messages %v", sent.Tools, sent.Messages)
	}
	if usage != [2]int{120, 7} {
		t.Fatalf("usage = %v", usage)
	}
}

func TestResponsesAgentMapsFunctionCallsBothWays(t *testing.T) {
	var sent struct {
		Instructions string           `json:"instructions"`
		Input        []map[string]any `json:"input"`
		Tools        []map[string]any `json:"tools"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&sent)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "completed",
			"output": []any{map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": "It says hello."}}}},
			"usage":  map[string]any{"input_tokens": 50, "output_tokens": 5},
		})
	}))
	defer server.Close()
	model := NewAgent(Config{BaseURL: server.URL, APIKey: "k", Model: "m", Protocol: ProtocolResponses, AllowPrivate: true})
	reply, err := model.Step(context.Background(), conversation(), specs)
	if err != nil || reply.Content != "It says hello." || len(reply.ToolCalls) != 0 {
		t.Fatalf("Step() = %+v, %v", reply, err)
	}
	if sent.Instructions != "Be useful." || len(sent.Tools) != 1 || sent.Tools[0]["name"] != "read_document" {
		t.Fatalf("instructions %q tools %v", sent.Instructions, sent.Tools)
	}
	kinds := []any{}
	for _, item := range sent.Input {
		kinds = append(kinds, item["type"])
	}
	if len(sent.Input) != 3 || sent.Input[1]["type"] != "function_call" || sent.Input[2]["type"] != "function_call_output" || sent.Input[2]["call_id"] != "c1" {
		t.Fatalf("input = %v (%v)", sent.Input, kinds)
	}
}

func TestAgentFailuresAreProviderErrorsAndStillCountUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTooManyRequests) }))
	defer server.Close()
	failed := false
	model := NewAgent(Config{BaseURL: server.URL, APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions, AllowPrivate: true,
		OnUsage: func(_ context.Context, _, _ int, _ time.Duration, ok bool) { failed = !ok }})
	if _, err := model.Step(context.Background(), conversation(), specs); !errors.Is(err, appchat.ErrRAGProviderUnavailable) {
		t.Fatalf("Step() error = %v", err)
	}
	if !failed {
		t.Fatal("a failed call was not reported")
	}
}

func TestAnswersAndEmbeddingsReportTheirTokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/embeddings" {
			vector := make([]float32, 1536)
			vector[0] = 1
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"index": 0, "embedding": vector}}, "usage": map[string]any{"prompt_tokens": 9}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": `{"answer":"x","source_ids":[]}`}}},
			"usage":   map[string]any{"prompt_tokens": 30, "completion_tokens": 4},
		})
	}))
	defer server.Close()
	var got [][2]int
	record := func(_ context.Context, in, out int, _ time.Duration, _ bool) { got = append(got, [2]int{in, out}) }
	cfg := Config{BaseURL: server.URL, APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions, AllowPrivate: true, OnUsage: record}
	if _, err := NewEmbedding(cfg).Embed(context.Background(), []string{"x"}); err != nil {
		t.Fatal(err)
	}
	if _, err := NewAnswer(cfg).Answer(context.Background(), answerInput([16]byte{1})); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != [2]int{9, 0} || got[1] != [2]int{30, 4} {
		t.Fatalf("usage = %v", got)
	}
}

func TestAgentStepReportsHowLongTheCallTook(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(40 * time.Millisecond)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"ok"}}],"usage":{"prompt_tokens":3,"completion_tokens":1}}`))
	}))
	defer server.Close()
	var took time.Duration
	model := NewAgent(Config{BaseURL: server.URL, APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions, AllowPrivate: true,
		OnUsage: func(_ context.Context, _, _ int, d time.Duration, _ bool) { took = d }})
	if _, err := model.Step(context.Background(), conversation(), specs); err != nil {
		t.Fatal(err)
	}
	if took < 40*time.Millisecond {
		t.Fatalf("took = %v, want at least the 40ms the server waited", took)
	}
}
