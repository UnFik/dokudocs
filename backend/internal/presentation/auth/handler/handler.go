package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/auth/dto"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/validator"
	"backend/internal/presentation/auth/presenter"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/request"
	"backend/internal/presentation/response"
)

type Handler struct {
	service  usecasecontract.AuthUseCase
	validate *validator.Validator
}

func NewHandler(service usecasecontract.AuthUseCase, validate *validator.Validator) *Handler {
	return &Handler{service: service, validate: validate}
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req presenter.LoginRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	resp, err := h.service.Login(r.Context(), dto.LoginRequest{Email: req.Email, Password: req.Password})
	if err != nil {
		switch {
		case errors.Is(err, constant.ErrInvalidCredentials):
			response.Error(w, http.StatusUnauthorized, constant.ErrInvalidCredentials.Error())
		case errors.Is(err, constant.ErrMissingCredential):
			response.Error(w, http.StatusBadRequest, constant.ErrMissingCredential.Error())
		default:
			response.Error(w, http.StatusInternalServerError, "internal server error")
		}
		return
	}
	_ = response.Data(w, http.StatusOK, presenter.LoginResponse{
		AccessToken: resp.AccessToken,
		User: presenter.ResponseUser{
			AccountNo: resp.User.AccountNo,
			Email:     resp.User.Email,
			Role:      resp.User.Role,
			Exp:       resp.User.Exp,
		},
	})
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, presenter.ResponseUser{
		AccountNo: user.AccountNo,
		Email:     user.Email,
		Role:      user.Role,
		Exp:       user.Exp,
	})
}
