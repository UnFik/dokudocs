package openai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func answerInput(id uuid.UUID) appchat.ModelInput {
	return appchat.ModelInput{
		Question: "Where is it deployed?", Language: "en",
		Sources: []model.RAGChunk{{ChunkID: id, Text: "It is deployed on a single VPS."}},
	}
}

func chatReply(content string) string {
	body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}}})
	return string(body)
}

func TestEmbeddingsGoToTheConfiguredBaseURLWithTheConfiguredModel(t *testing.T) {
	var path, auth, requestedModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, auth = r.URL.Path, r.Header.Get("Authorization")
		var body struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		requestedModel = body.Model
		vector := make([]float32, 1536)
		vector[0] = 1
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"index": 0, "embedding": vector}}})
	}))
	defer server.Close()
	embedder := NewEmbedding(Config{BaseURL: server.URL + "/api/v1", APIKey: "k-1", Model: "text-embed-x", AllowPrivate: true})
	vectors, err := embedder.Embed(context.Background(), []string{"hello"})
	if err != nil || len(vectors) != 1 || len(vectors[0]) != 1536 {
		t.Fatalf("Embed() = %d vectors, %v", len(vectors), err)
	}
	if path != "/api/v1/embeddings" || auth != "Bearer k-1" || requestedModel != "text-embed-x" {
		t.Fatalf("request = %s auth %q model %q", path, auth, requestedModel)
	}
	if embedder.Model() != "text-embed-x" {
		t.Fatalf("Model() = %q", embedder.Model())
	}
}

func TestTheEmbeddingProviderNameComesFromTheHost(t *testing.T) {
	for url, want := range map[string]string{
		"https://api.openai.com/v1":    "openai",
		"https://openrouter.ai/api/v1": "openrouter.ai",
		"http://localhost:11434/v1":    "localhost:11434",
	} {
		if got := NewEmbedding(Config{BaseURL: url, APIKey: "k", Model: "m"}).Provider(); got != want {
			t.Errorf("Provider() for %s = %q, want %q", url, got, want)
		}
	}
}

func TestAnEmbeddingOfAnotherLengthIsRefused(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"index": 0, "embedding": make([]float32, 768)}}})
	}))
	defer server.Close()
	_, err := NewEmbedding(Config{BaseURL: server.URL, APIKey: "k", Model: "m", AllowPrivate: true}).Embed(context.Background(), []string{"x"})
	if !errors.Is(err, appchat.ErrRAGProviderUnavailable) {
		t.Fatalf("Embed() error = %v, want ErrRAGProviderUnavailable", err)
	}
}

func TestChatCompletionsAnswerUsesTheStrictSchemaFirst(t *testing.T) {
	id := uuid.New()
	var path string
	var format map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path = r.URL.Path
		var body struct {
			Model          string         `json:"model"`
			ResponseFormat map[string]any `json:"response_format"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		format = body.ResponseFormat
		_, _ = w.Write([]byte(chatReply(`{"answer":"On a VPS.","source_ids":["` + id.String() + `"]}`)))
	}))
	defer server.Close()
	answerer := NewAnswer(Config{BaseURL: server.URL + "/v1", APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions, AllowPrivate: true})
	out, err := answerer.Answer(context.Background(), answerInput(id))
	if err != nil || out.Text != "On a VPS." || len(out.SourceIDs) != 1 || out.SourceIDs[0] != id {
		t.Fatalf("Answer() = %+v, %v", out, err)
	}
	if path != "/v1/chat/completions" || format["type"] != "json_schema" {
		t.Fatalf("request path %s, response_format %v", path, format)
	}
}

func TestChatCompletionsFallsBackToJSONObjectWhenTheSchemaIsRefused(t *testing.T) {
	id := uuid.New()
	var formats []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ResponseFormat struct {
				Type string `json:"type"`
			} `json:"response_format"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		formats = append(formats, body.ResponseFormat.Type)
		if body.ResponseFormat.Type == "json_schema" {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"response_format json_schema is not supported"}}`))
			return
		}
		_, _ = w.Write([]byte(chatReply(`{"answer":"On a VPS.","source_ids":["` + id.String() + `"]}`)))
	}))
	defer server.Close()
	answerer := NewAnswer(Config{BaseURL: server.URL, APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions, AllowPrivate: true})
	for range 2 {
		out, err := answerer.Answer(context.Background(), answerInput(id))
		if err != nil || out.Text != "On a VPS." {
			t.Fatalf("Answer() = %+v, %v", out, err)
		}
	}
	if got := strings.Join(formats, ","); got != "json_schema,json_object,json_object" {
		t.Fatalf("response formats = %s; want the schema once, then json_object remembered", got)
	}
}

func TestAnAnswerThatBreaksTheShapeIsRejected(t *testing.T) {
	for name, content := range map[string]string{
		"not json":          "Sure! It is on a VPS.",
		"answer not text":   `{"answer":42,"source_ids":[]}`,
		"no source ids key": `{"answer":"x"}`,
		"ids not a list":    `{"answer":"x","source_ids":"abc"}`,
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(chatReply(content))) }))
		answerer := NewAnswer(Config{BaseURL: server.URL, APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions, AllowPrivate: true})
		_, err := answerer.Answer(context.Background(), answerInput(uuid.New()))
		server.Close()
		if !errors.Is(err, appchat.ErrRAGProviderUnavailable) {
			t.Errorf("%s: Answer() error = %v, want ErrRAGProviderUnavailable", name, err)
		}
	}
}

func TestResponsesProtocolPostsToTheConfiguredBaseURL(t *testing.T) {
	id := uuid.New()
	var calls atomic.Int32
	var path string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		path = r.URL.Path
		inner, _ := json.Marshal(map[string]any{"answer": "On a VPS.", "source_ids": []string{id.String()}})
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "completed", "output": []any{map[string]any{
			"type": "message", "content": []any{map[string]string{"type": "output_text", "text": string(inner)}},
		}}})
	}))
	defer server.Close()
	answerer := NewAnswer(Config{BaseURL: server.URL + "/v1", APIKey: "k", Model: "m", Protocol: ProtocolResponses, AllowPrivate: true})
	if out, err := answerer.Answer(context.Background(), answerInput(id)); err != nil || out.Text != "On a VPS." {
		t.Fatalf("Answer() = %+v, %v", out, err)
	}
	if path != "/v1/responses" || calls.Load() != 1 {
		t.Fatalf("path %s after %d calls", path, calls.Load())
	}
}

func TestAGuardedClientWillNotAnswerFromAPrivateHost(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(chatReply("{}"))) }))
	defer server.Close()
	answerer := NewAnswer(Config{BaseURL: server.URL, APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions})
	if _, err := answerer.Answer(context.Background(), answerInput(uuid.New())); !errors.Is(err, appchat.ErrRAGProviderUnavailable) {
		t.Fatalf("Answer() error = %v, want the provider reported unavailable", err)
	}
}

func TestAnAnswerWrappedInACodeFenceIsStillRead(t *testing.T) {
	id := uuid.New()
	for name, content := range map[string]string{
		"json fence":  "```json\n{\"answer\":\"On a VPS.\",\"source_ids\":[\"" + id.String() + "\"]}\n```",
		"plain fence": "```\n{\"answer\":\"On a VPS.\",\"source_ids\":[\"" + id.String() + "\"]}\n```",
		"with a lead": "Here is the JSON:\n```json\n{\"answer\":\"On a VPS.\",\"source_ids\":[\"" + id.String() + "\"]}\n```",
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(chatReply(content))) }))
		answerer := NewAnswer(Config{BaseURL: server.URL, APIKey: "k", Model: "m", Protocol: ProtocolChatCompletions, AllowPrivate: true})
		out, err := answerer.Answer(context.Background(), answerInput(id))
		server.Close()
		if err != nil || out.Text != "On a VPS." || len(out.SourceIDs) != 1 {
			t.Errorf("%s: Answer() = %+v, %v", name, out, err)
		}
	}
}
