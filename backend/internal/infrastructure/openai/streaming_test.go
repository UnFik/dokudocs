package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"backend/internal/application/agent"
	"backend/internal/application/airuns"
	"github.com/google/uuid"
)

func TestAnswerTextArrivesBeforeChatCompletionsFinishes(t *testing.T) {
	source := uuid.New()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Stream bool `json:"stream"`
		}
		_ = json.NewDecoder(r.Body).Decode(&request)
		if !request.Stream {
			_, _ = w.Write([]byte(chatReply(`{"answer":"Halo dunia","source_ids":["` + source.String() + `"]}`)))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		first, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]string{"content": `{"answer":"Halo `}}}})
		_, _ = fmt.Fprintf(w, "data: %s\n\n", first)
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		last, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]string{"content": `dunia","source_ids":["` + source.String() + `"]}`}, "finish_reason": "stop"}}})
		_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", last)
	}))
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		server.Close()
	}()
	deltas := make(chan string, 8)
	ctx := airuns.WithOutput(context.Background(), func(event airuns.Event) error {
		if event.Type == "text_delta" {
			var data struct{ Text string }
			_ = json.Unmarshal(event.Data, &data)
			deltas <- data.Text
		}
		return nil
	})
	model := NewAnswer(Config{BaseURL: server.URL, APIKey: "test-key", Model: "test-model", Protocol: ProtocolChatCompletions, AllowPrivate: true})
	result := make(chan error, 1)
	go func() {
		out, err := model.Answer(ctx, answerInput(source))
		if err == nil && out.Text != "Halo dunia" {
			err = fmt.Errorf("unexpected final answer: %+v", out)
		}
		result <- err
	}()
	select {
	case delta := <-deltas:
		if delta != "Halo " {
			t.Fatalf("first delta: %q", delta)
		}
	case err := <-result:
		t.Fatalf("answer finished before any text delta: %v", err)
	case <-time.After(time.Second):
		t.Fatal("no answer delta before provider completion")
	}
	select {
	case err := <-result:
		t.Fatalf("provider finished unexpectedly: %v", err)
	default:
	}
	close(release)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}

func TestResponsesStreamsAnswerTextWithoutChatOnlyOptions(t *testing.T) {
	source := uuid.New()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if _, present := payload["stream_options"]; present {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		first, _ := json.Marshal(map[string]any{"type": "response.output_text.delta", "delta": `{"answer":"Halo `})
		_, _ = fmt.Fprintf(w, "event: response.output_text.delta\ndata: %s\n\n", first)
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		last, _ := json.Marshal(map[string]any{"type": "response.output_text.delta", "delta": `🌏","source_ids":["` + source.String() + `"]}`})
		complete, _ := json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"status": "completed", "usage": map[string]int{"input_tokens": 7, "output_tokens": 2}, "output": []any{map[string]any{"type": "message", "content": []any{map[string]string{"type": "output_text", "text": `{"answer":"Halo 🌏","source_ids":["` + source.String() + `"]}`}}}}}})
		_, _ = fmt.Fprintf(w, "data: %s\n\ndata: %s\n\n", last, complete)
	}))
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		server.Close()
	}()
	deltas := make(chan string, 8)
	usage := make(chan [3]int, 1)
	ctx := airuns.WithOutput(context.Background(), func(event airuns.Event) error {
		if event.Type == "text_delta" {
			var value struct{ Text string }
			_ = json.Unmarshal(event.Data, &value)
			deltas <- value.Text
		}
		return nil
	})
	model := NewAnswer(Config{BaseURL: server.URL, APIKey: "test-key", Model: "test-model", Protocol: ProtocolResponses, AllowPrivate: true, OnUsage: func(_ context.Context, in, out int, _ time.Duration, ok bool) {
		success := 0
		if ok {
			success = 1
		}
		usage <- [3]int{in, out, success}
	}})
	result := make(chan error, 1)
	go func() {
		out, err := model.Answer(ctx, answerInput(source))
		if err == nil && out.Text != "Halo 🌏" {
			err = fmt.Errorf("unexpected final answer: %+v", out)
		}
		result <- err
	}()
	select {
	case text := <-deltas:
		if text != "Halo " {
			t.Fatalf("delta: %q", text)
		}
	case err := <-result:
		t.Fatalf("completed before delta: %v", err)
	case <-time.After(time.Second):
		t.Fatal("no Responses delta")
	}
	close(release)
	if err := <-result; err != nil {
		t.Fatal(err)
	}
	if got := <-usage; got != [3]int{7, 2, 1} {
		t.Fatalf("usage: %v", got)
	}
}

func TestAgentReceivesCompleteToolArgumentsWithoutExposingThemAsText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		if payload["stream"] != true {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		chunks := []map[string]any{
			{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "Saya membaca dokumen.", "tool_calls": []any{map[string]any{"index": 0, "id": "call-1", "function": map[string]string{"name": "read_document", "arguments": `{"document_id":"`}}}}}}},
			{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]string{"arguments": `doc-1"}`}}}}, "finish_reason": "tool_calls"}}},
		}
		for _, chunk := range chunks {
			raw, _ := json.Marshal(chunk)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
			w.(http.Flusher).Flush()
		}
		_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	var visible string
	ctx := airuns.WithOutput(context.Background(), func(event airuns.Event) error {
		if event.Type == "text_delta" {
			var data struct{ Text string }
			_ = json.Unmarshal(event.Data, &data)
			visible += data.Text
		}
		return nil
	})
	model := NewAgent(Config{BaseURL: server.URL, APIKey: "test-key", Model: "test-model", Protocol: ProtocolChatCompletions, AllowPrivate: true})
	reply, err := model.Step(ctx, []agent.Message{{Role: "user", Content: "Read my document"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(reply.ToolCalls) != 1 || reply.ToolCalls[0].ID != "call-1" || reply.ToolCalls[0].Name != "read_document" || string(reply.ToolCalls[0].Arguments) != `{"document_id":"doc-1"}` {
		t.Fatalf("tool call: %+v", reply)
	}
	if visible != "Saya membaca dokumen." {
		t.Fatalf("exposed tool arguments: %q", visible)
	}
}

func TestChatStreamWithoutItsTerminatorIsNotACompletedAnswer(t *testing.T) {
	source := uuid.New()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]string{"content": `{"answer":"Terpotong","source_ids":["` + source.String() + `"]}`}, "finish_reason": "stop"}}})
		_, _ = fmt.Fprintf(w, "data: %s\n\n", chunk)
	}))
	defer server.Close()
	ctx := airuns.WithOutput(context.Background(), func(airuns.Event) error { return nil })
	_, err := NewAnswer(Config{BaseURL: server.URL, APIKey: "test-key", Model: "test-model", Protocol: ProtocolChatCompletions, AllowPrivate: true}).Answer(ctx, answerInput(source))
	if err == nil {
		t.Fatal("a truncated stream was accepted as a completed answer")
	}
}

func TestAProviderThatRefusesStreamOptionsIsAskedAgainWithoutThem(t *testing.T) {
	source := uuid.New()
	var withOptions, without int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		if _, has := request["stream_options"]; has {
			withOptions++
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		without++
		w.Header().Set("Content-Type", "text/event-stream")
		last, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]string{"content": `{"answer":"Halo","source_ids":["` + source.String() + `"]}`}, "finish_reason": "stop"}}})
		_, _ = fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", last)
	}))
	defer server.Close()
	ctx := airuns.WithOutput(context.Background(), func(airuns.Event) error { return nil })
	model := NewAnswer(Config{BaseURL: server.URL, APIKey: "test-key", Model: "test-model", Protocol: ProtocolChatCompletions, AllowPrivate: true})
	output, err := model.Answer(ctx, answerInput(source))
	if err != nil || output.Text != "Halo" {
		t.Fatalf("Answer() = %+v, %v", output, err)
	}
	if withOptions != 1 || without != 1 {
		t.Fatalf("requests with/without stream_options = %d/%d, want 1/1", withOptions, without)
	}
}
