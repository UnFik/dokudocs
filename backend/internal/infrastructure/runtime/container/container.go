package container

import (
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
	// Mailer sends email; nil when SMTP is not configured.
	Mailer mail.Mailer
	// Push sends to a person's browsers; nil when push is not configured.
	Push notification.PushSender
	// IdentityProvider replaces the Google provider built from the config; tests set it.
	IdentityProvider repository.IdentityProvider
}

func New(db database.DB, log *logger.Logger, validate *validator.Validator) *Container {
	return &Container{DB: db, Logger: log, Validator: validate}
}
