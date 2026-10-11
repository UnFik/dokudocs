package main

import (
	"context"
	"fmt"

	"backend/internal/application/aisettings"
	"backend/internal/config"
	"backend/internal/infrastructure/aiprovider"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/openai"
	settingsrepo "backend/internal/infrastructure/repository/aisettings"
	documentrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/secretbox"
)

// newSecretBox refuses to run without the key that seals stored API keys, so a missing
// variable stops the server at start and never leaves a key unsealed.
func newSecretBox(cfg config.Config) (*secretbox.Box, error) {
	box, err := secretbox.New(cfg.AISettingsEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("AI_SETTINGS_ENCRYPTION_KEY: %w (generate one with: openssl rand -base64 32)", err)
	}
	return box, nil
}

// setUpAISettings wires the AI provider settings into the container: the chatbot reads its
// answer and embedding models from the database through a resolver, and the environment
// only fills an empty table on first run.
func setUpAISettings(ctx context.Context, cfg config.Config, c *container.Container) (*aiprovider.Resolver, *aisettings.Service, error) {
	box, err := newSecretBox(cfg)
	if err != nil {
		return nil, nil, err
	}
	db := database.DB(c.DB)
	store := settingsrepo.NewStore(db)
	resolver := aiprovider.NewResolver(store, box, cfg.AllowPrivateAIHosts)
	service := aisettings.NewService(aisettings.Deps{
		Store: store, Index: documentrepo.NewRepository(db), Cipher: box,
		Tester: aiprovider.NewTester(cfg.AllowPrivateAIHosts), ProviderName: openai.ProviderName,
		AllowPrivate: cfg.AllowPrivateAIHosts, OnChange: resolver.Invalidate,
	})
	if err := service.Seed(ctx, aisettings.Seed{APIKey: cfg.OpenAIAPIKey, AnswerModel: cfg.RAGAnswerModel, EmbeddingModel: cfg.RAGEmbeddingModel}); err != nil {
		return nil, nil, fmt.Errorf("seed AI settings from the environment: %w", err)
	}
	c.AISettings = service
	c.RAGAnswerModel = resolver
	c.RAGEmbeddingModel = resolver.Embedder(aisettings.PurposeEmbedding)
	return resolver, service, nil
}
