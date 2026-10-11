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
	cfg     Config
	baseURL string
	apiKey  string
	model   string
	client  *http.Client
}

func NewEmbeddingModel(apiKey, model string) *EmbeddingModel {
	return NewEmbedding(Config{APIKey: apiKey, Model: model})
}

func NewEmbedding(cfg Config) *EmbeddingModel {
	return &EmbeddingModel{cfg: cfg, baseURL: cfg.baseURL(), apiKey: cfg.APIKey, model: cfg.Model, client: cfg.client(30 * time.Second)}
}

func (m *EmbeddingModel) Provider() string { return ProviderName(m.baseURL) }
func (m *EmbeddingModel) Model() string    { return m.model }
func (*EmbeddingModel) Dimensions() int    { return embeddingDimensions }

func (m *EmbeddingModel) Embed(ctx context.Context, inputs []string) (vectors [][]float32, err error) {
	tokens := 0
	defer func() { m.cfg.report(ctx, tokens, 0, err == nil) }()
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
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.baseURL+"/embeddings", bytes.NewReader(payload))
	if err != nil {
		return nil, errors.New("embedding request failed")
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: embedding provider unavailable: %s", appchat.ErrRAGProviderUnavailable, reason(err))
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
		Usage struct {
			PromptTokens int `json:"prompt_tokens"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(res.Body).Decode(&response); err != nil || len(response.Data) != len(inputs) {
		return nil, fmt.Errorf("%w: embedding provider returned an invalid response", appchat.ErrRAGProviderUnavailable)
	}
	tokens = response.Usage.PromptTokens
	vectors = make([][]float32, len(inputs))
	seen := make([]bool, len(inputs))
	for _, item := range response.Data {
		if len(item.Embedding) != embeddingDimensions && len(item.Embedding) > 0 {
			return nil, fmt.Errorf("%w: embedding provider returned %d numbers per text, Dokudocs needs %d", appchat.ErrRAGProviderUnavailable, len(item.Embedding), embeddingDimensions)
		}
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
