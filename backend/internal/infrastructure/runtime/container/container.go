package container

import (
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/validator"
)

type Container struct {
	DB        database.DB
	Logger    *logger.Logger
	Validator *validator.Validator
}

func New(db database.DB, log *logger.Logger, validate *validator.Validator) *Container {
	return &Container{DB: db, Logger: log, Validator: validate}
}
