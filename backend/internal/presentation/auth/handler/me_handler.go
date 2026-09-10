package handler

import (
	"net/http"

	"backend/constant"
	"backend/internal/presentation/auth/presenter"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"
)

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, presenter.ResponseUser{
		ID:        user.ID,
		AccountNo: user.AccountNo,
		Email:     user.Email,
		Role:      user.Role,
		Exp:       user.Exp,
	})
}
