package container

import (
	appchat "backend/internal/application/rag/usecase"
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
}

func New(db database.DB, log *logger.Logger, validate *validator.Validator) *Container {
	return &Container{DB: db, Logger: log, Validator: validate}
}
