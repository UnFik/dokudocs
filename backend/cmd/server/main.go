package main

import (
	"context"
	"time"

	appchat "backend/internal/application/rag/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/api"
	"backend/internal/infrastructure/collaboration/redisfanout"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/openai"
	"backend/internal/infrastructure/postgres"
	documentrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"
)

// @title Dokudocs API
// @version 1.0
// @description API documentation for Dokudocs backend service.
// @BasePath /api/v1
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Type "Bearer" followed by a space and JWT token.
func main() {
	log := logger.New()
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := postgres.Open(cfg)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()
	c := container.New(db, log, validator.New())
	if cfg.OpenAIAPIKey != "" {
		c.RAGAnswerModel = openai.NewAnswerModel(cfg.OpenAIAPIKey, cfg.RAGAnswerModel)
		c.RAGEmbeddingModel = openai.NewEmbeddingModel(cfg.OpenAIAPIKey, cfg.RAGEmbeddingModel)
	}
	if cfg.RedisURL != "" {
		broker, err := redisfanout.New(cfg.RedisURL)
		if err != nil {
			log.Fatalf("create collaboration Redis broker: %v", err)
		}
		c.CollaborationBroker = broker
		presence, err := redisfanout.NewPresenceStore(cfg.RedisURL, redisfanout.DefaultPresenceTTL)
		if err != nil {
			log.Fatalf("create collaboration presence store: %v", err)
		}
		c.CollaborationPresence = presence
	}
	workerCtx, stopWorkers := context.WithCancel(context.Background())
	defer stopWorkers()
	go runRAGIndexWorker(workerCtx, documentrepo.NewRepository(db), c.RAGEmbeddingModel, log)
	if err := api.RunHTTPServer(workerCtx, cfg, c); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func runRAGIndexWorker(ctx context.Context, repo *documentrepo.Repository, embedder appchat.EmbeddingModel, log *logger.Logger) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		if _, err := repo.RebuildStaleRAGIndexes(ctx, 100); err != nil {
			log.Printf("rebuild stale RAG indexes: %v", err)
		}
		if embedder != nil {
			if err := embedRAGBacklog(ctx, repo, embedder); err != nil {
				log.Printf("embed RAG chunks: %v", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
