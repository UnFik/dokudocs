package handler

import (
	"net/http"

	"backend/constant"
	"backend/internal/presentation/auth/presenter"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"
)

// Me returns details of the currently authenticated user.
// @Summary Get current user
// @Description Retrieve current user info from JWT claims
// @Tags Auth
// @Produce json
// @Security BearerAuth
// @Success 200 {object} response.Envelope{data=presenter.ResponseUser}
// @Failure 401 {object} response.ErrorEnvelope
// @Router /auth/me [get]
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
		return
	}
	_ = response.Data(w, http.StatusOK, presenter.ResponseUser{
		ID:            user.ID,
		AccountNo:     user.AccountNo,
		Email:         user.Email,
		Role:          user.Role,
		Exp:           user.Exp,
		EmailVerified: user.EmailVerified,
	})
}
