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
		case errors.Is(err, constant.ErrMissingCredential):
			response.Error(w, http.StatusBadRequest, constant.ErrMissingCredential.Error())
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
