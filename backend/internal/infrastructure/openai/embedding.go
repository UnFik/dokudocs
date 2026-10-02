package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	appchat "backend/internal/application/rag/usecase"
)

const embeddingDimensions = 1536

type EmbeddingModel struct {
	apiKey string
	model  string
	client *http.Client
}

func NewEmbeddingModel(apiKey, model string) *EmbeddingModel {
	return &EmbeddingModel{apiKey: apiKey, model: model, client: &http.Client{Timeout: 30 * time.Second}}
}

func (*EmbeddingModel) Provider() string { return "openai" }
func (m *EmbeddingModel) Model() string  { return m.model }
func (*EmbeddingModel) Dimensions() int  { return embeddingDimensions }

func (m *EmbeddingModel) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	if strings.TrimSpace(m.apiKey) == "" || strings.TrimSpace(m.model) == "" || len(inputs) == 0 || len(inputs) > 32 {
		return nil, errors.New("embedding request is invalid")
	}
	for _, input := range inputs {
		if strings.TrimSpace(input) == "" {
			return nil, errors.New("embedding request is invalid")
		}
	}
	payload, err := json.Marshal(struct {
		Model string   `json:"model"`
		Input []string `json:"input"`
	}{Model: m.model, Input: inputs})
	if err != nil {
		return nil, errors.New("embedding request failed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/embeddings", bytes.NewReader(payload))
	if err != nil {
		return nil, errors.New("embedding request failed")
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: embedding provider unavailable", appchat.ErrRAGProviderUnavailable)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: embedding provider returned HTTP %d", appchat.ErrRAGProviderUnavailable, res.StatusCode)
	}
	var response struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil || len(response.Data) != len(inputs) {
		return nil, fmt.Errorf("%w: embedding provider returned an invalid response", appchat.ErrRAGProviderUnavailable)
	}
	vectors := make([][]float32, len(inputs))
	seen := make([]bool, len(inputs))
	for _, item := range response.Data {
		if item.Index < 0 || item.Index >= len(inputs) || seen[item.Index] || len(item.Embedding) != embeddingDimensions {
			return nil, fmt.Errorf("%w: embedding provider returned an invalid response", appchat.ErrRAGProviderUnavailable)
		}
		seen[item.Index] = true
		vectors[item.Index] = item.Embedding
	}
	for _, ok := range seen {
		if !ok {
			return nil, fmt.Errorf("%w: embedding provider returned an invalid response", appchat.ErrRAGProviderUnavailable)
		}
	}
	return vectors, nil
}
