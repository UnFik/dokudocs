package main

import (
	"context"
	"os"
	"time"

	appchat "backend/internal/application/rag/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/api"
	"backend/internal/infrastructure/api/routes"
	"backend/internal/infrastructure/firebase"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/mail"
	"backend/internal/infrastructure/openai"
	"backend/internal/infrastructure/postgres"
	documentrepo "backend/internal/infrastructure/repository/document"
	pushrepo "backend/internal/infrastructure/repository/push"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/tracing"
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
	shutdownTracing, err := tracing.Setup(context.Background(), "api", cfg.OTLPEndpoint)
	if err != nil {
		log.Fatalf("set up tracing: %v", err)
	}
	defer func() { _ = shutdownTracing(context.Background()) }()
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
	if cfg.MailerConfigured() {
		c.Mailer = mail.NewSMTP(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom)
	}
	if cfg.PushConfigured() {
		if err := setUpPush(context.Background(), cfg, c); err != nil {
			log.Fatalf("set up push: %v", err)
		}
	}
	workerCtx, stopWorkers := context.WithCancel(context.Background())
	defer stopWorkers()
	go runRAGIndexWorker(workerCtx, documentrepo.NewRepository(db), c.RAGEmbeddingModel, log)
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
				if _, err := routes.SweepAssets(workerCtx, c, cfg, 24*time.Hour); err != nil {
					log.Errorf("sweep assets: %v", err)
				}
			}
		}
	}()
	if err := api.RunHTTPServer(workerCtx, cfg, c); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// setUpPush signs in to Firebase with the service account, so a wrong key stops
// the server at start instead of failing the first notification.
func setUpPush(ctx context.Context, cfg config.Config, c *container.Container) error {
	key := []byte(cfg.FirebaseCredentialsJSON)
	if len(key) == 0 {
		var err error
		if key, err = os.ReadFile(cfg.FirebaseCredentialsFile); err != nil {
			return err
		}
	}
	var options []firebase.Option
	if cfg.FirebaseFCMEndpoint != "" {
		options = append(options, firebase.WithEndpoint(cfg.FirebaseFCMEndpoint))
	}
	sender, project, err := firebase.NewFromCredentials(ctx, key, cfg.FirebaseProjectID, pushrepo.NewStore(c.DB), options...)
	if err != nil {
		return err
	}
	c.Push, c.PushProjectID = sender, project
	return nil
}

func runRAGIndexWorker(ctx context.Context, repo *documentrepo.Repository, embedder appchat.EmbeddingModel, log *logger.Logger) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		if _, err := repo.RebuildStaleRAGIndexes(ctx, 100); err != nil {
			log.Errorf("rebuild stale RAG indexes: %v", err)
		}
		if embedder != nil {
			if err := embedRAGBacklog(ctx, repo, embedder); err != nil {
				log.Errorf("embed RAG chunks: %v", err)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
