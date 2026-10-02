package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/presentation/auth/presenter"
	"backend/internal/presentation/request"
	"backend/internal/presentation/response"
)

// Register creates a new user account.
// @Summary User registration
// @Description Register a new user with email, password, and full name
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body presenter.RegisterRequest true "Register request payload"
// @Success 201 {object} response.Envelope{data=presenter.LoginResponse}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Failure 500 {object} response.ErrorEnvelope
// @Router /auth/register [post]
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req presenter.RegisterRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	resp, err := h.service.Register(r.Context(), dto.RegisterRequest{
		Email:    req.Email,
		Password: req.Password,
		FullName: req.FullName,
	})
	if err != nil {
		switch {
		case errors.Is(err, constant.ErrEmailAlreadyExists):
			response.Error(w, http.StatusConflict, constant.ErrEmailAlreadyExists.Error())
		case errors.Is(err, constant.ErrMissingCredential), errors.Is(err, constant.ErrInvalidRegistration):
			response.Error(w, http.StatusBadRequest, err.Error())
		default:
			response.Error(w, http.StatusInternalServerError, "internal server error")
		}
		return
	}
	_ = response.Data(w, http.StatusCreated, presenter.LoginResponse{
		AccessToken: resp.AccessToken,
		User: presenter.ResponseUser{
			ID:        resp.User.ID,
			AccountNo: resp.User.AccountNo,
			Email:     resp.User.Email,
			Role:      resp.User.Role,
			Exp:       resp.User.Exp,
		},
	})
}
