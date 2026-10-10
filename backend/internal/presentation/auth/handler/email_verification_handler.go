package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	"backend/internal/presentation/auth/presenter"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/request"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// ResendVerificationEmail mails the signed-in User a new verification link.
// @Summary Send the email verification link again
// @Tags Auth
// @Security BearerAuth
// @Success 204
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 429 {object} response.ErrorEnvelope
// @Failure 503 {object} response.ErrorEnvelope
// @Router /auth/email/resend [post]
func (h *Handler) ResendVerificationEmail(w http.ResponseWriter, r *http.Request) {
	user, ok := middleware.UserFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
		return
	}
	userID, err := uuid.Parse(user.ID)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
		return
	}
	switch err := h.service.SendVerificationEmail(r.Context(), userID); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, constant.ErrVerificationTooSoon):
		w.Header().Set("Retry-After", "60")
		response.Error(w, http.StatusTooManyRequests, err.Error())
	case errors.Is(err, constant.ErrEmailNotConfigured):
		response.Error(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, constant.ErrEmailNotSent):
		response.Error(w, http.StatusBadGateway, constant.ErrEmailNotSent.Error())
	default:
		response.Error(w, http.StatusInternalServerError, "internal server error")
	}
}

// VerifyEmail uses a verification link up and signs the User in as verified.
// @Summary Verify an email address
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body presenter.VerifyEmailRequest true "Link token"
// @Success 200 {object} response.Envelope{data=presenter.LoginResponse}
// @Failure 400 {object} response.ErrorEnvelope
// @Router /auth/email/verify [post]
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req presenter.VerifyEmailRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	resp, err := h.service.VerifyEmail(r.Context(), req.Token)
	if err != nil {
		if errors.Is(err, constant.ErrInvalidVerificationToken) {
			response.Error(w, http.StatusBadRequest, err.Error())
			return
		}
		response.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}
	_ = response.Data(w, http.StatusOK, presenter.LoginResponse{
		AccessToken: resp.AccessToken,
		User: presenter.ResponseUser{
			ID:            resp.User.ID,
			AccountNo:     resp.User.AccountNo,
			Email:         resp.User.Email,
			Role:          resp.User.Role,
			Exp:           resp.User.Exp,
			EmailVerified: resp.User.EmailVerified,
		},
	})
}
