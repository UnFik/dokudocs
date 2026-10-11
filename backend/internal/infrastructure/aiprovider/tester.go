// Package aiprovider connects the stored AI provider settings to the clients that use them.
package aiprovider

import (
	"context"
	"errors"
	"time"

	app "backend/internal/application/aisettings"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/openai"

	"github.com/google/uuid"
)

// Tester checks a setting by making one small real request.
type Tester struct{ allowPrivate bool }

func NewTester(allowPrivate bool) *Tester { return &Tester{allowPrivate: allowPrivate} }

func openaiConfig(cfg app.Config, allowPrivate bool) openai.Config {
	return openai.Config{BaseURL: cfg.BaseURL, APIKey: cfg.APIKey, Model: cfg.Model, Protocol: cfg.Protocol, AllowPrivate: allowPrivate}
}

func (t *Tester) Test(ctx context.Context, purpose string, cfg app.Config) error {
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	var err error
	if purpose == app.PurposeAnswer {
		_, err = openai.NewAnswer(openaiConfig(cfg, t.allowPrivate)).Answer(ctx, appchat.ModelInput{
			Question: "Where is the service deployed?", Language: "en",
			Sources: []model.RAGChunk{{ChunkID: uuid.New(), Text: "The service is deployed on a single server."}},
		})
	} else {
		_, err = openai.NewEmbedding(openaiConfig(cfg, t.allowPrivate)).Embed(ctx, []string{"connection test"})
	}
	if err != nil {
		return errors.New(trimPrefix(err.Error()))
	}
	return nil
}

// trimPrefix drops the generic "RAG model provider is unavailable: " lead so the
// message starts with what the provider did.
func trimPrefix(message string) string {
	const lead = "RAG model provider is unavailable: "
	if len(message) > len(lead) && message[:len(lead)] == lead {
		return message[len(lead):]
	}
	return message
}
