package openai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type answerRoundTripper func(*http.Request) (*http.Response, error)

func (roundTrip answerRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func TestAnswerRequestsConflictDisclosureAndReturnsBothSourceIDs(t *testing.T) {
	firstChunkID, secondChunkID := uuid.New(), uuid.New()
	structuredAnswer, err := json.Marshal(struct {
		Answer    string   `json:"answer"`
		SourceIDs []string `json:"source_ids"`
	}{
		Answer:    "The documents conflict: one says the service restarts, the other says it never restarts.",
		SourceIDs: []string{firstChunkID.String(), secondChunkID.String()},
	})
	if err != nil {
		t.Fatal(err)
	}
	responseBody, err := json.Marshal(map[string]any{
		"status": "completed",
		"output": []any{map[string]any{
			"type": "message",
			"content": []any{map[string]string{
				"type": "output_text", "text": string(structuredAnswer),
			}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var requestBody struct {
		Store        bool   `json:"store"`
		Instructions string `json:"instructions"`
		Input        string `json:"input"`
	}
	adapter := NewAnswerModel("test-key", "test-model")
	adapter.client = &http.Client{Transport: answerRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.URL.String() != "https://api.openai.com/v1/responses" {
			t.Errorf("request = %s %s, want Responses API POST", request.Method, request.URL)
		}
		if request.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("authorization header = %q", request.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(request.Body).Decode(&requestBody); err != nil {
			t.Errorf("decode provider request: %v", err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(string(responseBody))),
			Header:     make(http.Header),
		}, nil
	})}

	answer, err := adapter.Answer(context.Background(), appchat.ModelInput{
		Question: "Do the documents conflict?",
		Language: "en",
		Sources: []model.RAGChunk{
			{ChunkID: firstChunkID, Text: "The service restarts after a failed health check."},
			{ChunkID: secondChunkID, Text: "The service never restarts after a failed health check."},
		},
	})
	if err != nil {
		t.Fatalf("answer: %v", err)
	}
	if len(answer.SourceIDs) != 2 || answer.SourceIDs[0] != firstChunkID || answer.SourceIDs[1] != secondChunkID {
		t.Fatalf("source IDs = %v, want both conflicting chunks", answer.SourceIDs)
	}
	if requestBody.Store {
		t.Fatal("provider request enabled content storage")
	}
	if !strings.Contains(requestBody.Instructions, "If sources conflict, state the conflict and cite all conflicting sources") {
		t.Fatalf("provider instructions do not require conflict disclosure: %q", requestBody.Instructions)
	}
	var input struct {
		Sources []struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		} `json:"sources"`
	}
	if err := json.Unmarshal([]byte(requestBody.Input), &input); err != nil || len(input.Sources) != 2 || input.Sources[0].ID != firstChunkID.String() || input.Sources[1].ID != secondChunkID.String() {
		t.Fatalf("provider evidence = %+v, error = %v, want both conflicting sources", input.Sources, err)
	}
}
