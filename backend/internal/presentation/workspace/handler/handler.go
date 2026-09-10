package handler

import (
	"net/http"

	"backend/constant"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/validator"
	"backend/internal/presentation/middleware"

	"github.com/google/uuid"
)

type Handler struct {
	service  usecasecontract.WorkspaceUseCase
	validate *validator.Validator
}

func NewHandler(service usecasecontract.WorkspaceUseCase, validate *validator.Validator) *Handler {
	return &Handler{service: service, validate: validate}
}

func getUserUUID(r *http.Request) (uuid.UUID, error) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		return uuid.Nil, constant.ErrUnauthorized
	}
	return uuid.Parse(user.ID)
}
