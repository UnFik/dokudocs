package container

import (
	"backend/internal/application/collaboration"
	appchat "backend/internal/application/rag/usecase"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/validator"
)

type Container struct {
	DB                  database.DB
	Logger              *logger.Logger
	Validator           *validator.Validator
	CollaborationBroker collaboration.Broker
	// CollaborationPresence shares who is in a document across instances; nil
	// keeps presence local to one instance.
	CollaborationPresence collaboration.PresenceStore
	RAGAnswerModel        appchat.AnswerModel
	RAGEmbeddingModel     appchat.EmbeddingModel
}

func New(db database.DB, log *logger.Logger, validate *validator.Validator) *Container {
	return &Container{DB: db, Logger: log, Validator: validate}
}
