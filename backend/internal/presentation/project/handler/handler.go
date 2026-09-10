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
	service  usecasecontract.ProjectUseCase
	validate *validator.Validator
}

func NewHandler(service usecasecontract.ProjectUseCase, validate *validator.Validator) *Handler {
	return &Handler{service: service, validate: validate}
}

func getUserAndWorkspace(r *http.Request) (uuid.UUID, uuid.UUID, error) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		return uuid.Nil, uuid.Nil, constant.ErrUnauthorized
	}
	userUUID, err := uuid.Parse(user.ID)
	if err != nil {
		return uuid.Nil, uuid.Nil, constant.ErrUnauthorized
	}
	wsID, _, ok := middleware.WorkspaceFromContext(r.Context())
	if !ok {
		return uuid.Nil, uuid.Nil, constant.ErrForbidden
	}
	return userUUID, wsID, nil
}

func parsePathUUID(r *http.Request, key string) (uuid.UUID, error) {
	idStr := r.PathValue(key)
	return uuid.Parse(idStr)
}
