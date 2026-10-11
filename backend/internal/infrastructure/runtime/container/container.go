package container

import (
	"context"

	"backend/internal/application/agent"
	"backend/internal/application/aisettings"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/contract/mail"
	"backend/internal/domain/contract/notification"
	"backend/internal/domain/contract/repository"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/validator"
)

type Container struct {
	DB                database.DB
	Logger            *logger.Logger
	Validator         *validator.Validator
	RAGAnswerModel    appchat.AnswerModel
	RAGEmbeddingModel appchat.EmbeddingModel
	// AgentModel thinks for the Agent; nil, or not ready, keeps chat on documents only.
	AgentModel AgentModel
	// LiveRooms reads and edits rooms for the Agent; nil uses the collaboration service from the config.
	LiveRooms agent.LiveRooms
	// AISettings is the Superadmin's AI provider settings; nil leaves their routes off.
	AISettings *aisettings.Service
	// Mailer sends email; nil when SMTP is not configured.
	Mailer mail.Mailer
	// Push sends to a person's browsers; nil when push is not configured.
	Push notification.PushSender
	// PushProjectID is the Firebase project push is sent through; empty when off.
	PushProjectID string
	// IdentityProvider replaces the Google provider built from the config; tests set it.
	IdentityProvider repository.IdentityProvider
}

func New(db database.DB, log *logger.Logger, validate *validator.Validator) *Container {
	return &Container{DB: db, Logger: log, Validator: validate}
}

// AgentModel is the agent model and whether one is set up now.
type AgentModel interface {
	agent.Model
	AgentReady(ctx context.Context) bool
}
