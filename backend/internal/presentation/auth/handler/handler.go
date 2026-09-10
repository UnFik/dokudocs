package handler

import (
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/validator"
)

type Handler struct {
	service  usecasecontract.AuthUseCase
	validate *validator.Validator
}

func NewHandler(service usecasecontract.AuthUseCase, validate *validator.Validator) *Handler {
	return &Handler{service: service, validate: validate}
}
