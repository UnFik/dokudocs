// Package aiprovider connects the stored AI provider settings to the clients that use them.
package aiprovider

import (
	"context"
	"errors"
	"time"

	agentapp "backend/internal/application/agent"
	"backend/internal/application/airuns"
	app "backend/internal/application/aisettings"
	"backend/internal/application/aiusage"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/openai"

	"github.com/google/uuid"
)

// Tester checks a setting by making one small real request.
type Tester struct {
	allowPrivate bool
	usage        aiusage.Store
}

func NewTester(allowPrivate bool) *Tester { return &Tester{allowPrivate: allowPrivate} }

// WithUsage counts connection tests in the usage store.
func (t *Tester) WithUsage(store aiusage.Store) *Tester {
	t.usage = store
	return t
}

func (t *Tester) openaiConfig(purpose string, cfg app.Config) openai.Config {
	out := openai.Config{BaseURL: cfg.BaseURL, APIKey: cfg.APIKey, Model: cfg.Model, Protocol: cfg.Protocol, AllowPrivate: t.allowPrivate}
	if t.usage != nil {
		out.OnUsage = aiusage.Recorder(t.usage, openai.ProviderName(cfg.BaseURL), cfg.Model, purpose)
	}
	return out
}

// Test makes one request and reports what it learned. Inside an AI run the request
// streams, so the report can say whether the provider streams; elsewhere it stays
// unverified. The sample text the model writes is dropped: it is not a chat message.
func (t *Tester) Test(ctx context.Context, purpose string, cfg app.Config) (app.TestReport, error) {
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	ctx, streams := openai.WithStreamReport(ctx)
	if airuns.HasOutput(ctx) {
		ctx = airuns.WithOutput(ctx, func(airuns.Event) error { return nil })
	}
	ctx = aiusage.With(ctx, aiusage.Attribution{Feature: aiusage.FeatureConnectionTest})
	var err error
	switch purpose {
	case app.PurposeAnswer:
		_, err = openai.NewAnswer(t.openaiConfig(purpose, cfg)).Answer(ctx, appchat.ModelInput{
			Question: "Where is the service deployed?", Language: "en",
			Sources: []model.RAGChunk{{ChunkID: uuid.New(), Text: "The service is deployed on a single server."}},
		})
	case app.PurposeAgent, app.PurposeAgentSmall:
		var reply agentapp.Message
		reply, err = openai.NewAgent(t.openaiConfig(purpose, cfg)).Step(ctx, []agentapp.Message{
			{Role: "system", Content: "This is a connection test. Call the ping tool once."},
			{Role: "user", Content: "ping"},
		}, []agentapp.ToolSpec{{Name: "ping", Description: "Answers pong.", Parameters: map[string]any{"type": "object", "properties": map[string]any{}}}})
		if err == nil && len(reply.ToolCalls) == 0 {
			return app.TestReport{}, errors.New("the model answered without calling a tool; pick a model and protocol that support tool calling")
		}
	default:
		_, err = openai.NewEmbedding(t.openaiConfig(purpose, cfg)).Embed(ctx, []string{"connection test"})
	}
	if err != nil {
		return app.TestReport{}, errors.New(trimPrefix(err.Error()))
	}
	report := app.TestReport{Streaming: streams.Supported()}
	if purpose == app.PurposeEmbedding {
		// A vector has no text to stream.
		report.Streaming = "unverified"
	}
	return report, nil
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
