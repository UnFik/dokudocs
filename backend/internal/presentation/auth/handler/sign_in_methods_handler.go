package handler

import (
	"errors"
	"net/http"
	"regexp"

	"backend/constant"
	"backend/internal/presentation/auth/presenter"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/request"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

var providerName = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,19}$`)

func currentUserID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	user, ok := middleware.UserFromContext(r.Context())
	id, err := uuid.Parse(user.ID)
	if !ok || err != nil {
		response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
		return uuid.Nil, false
	}
	return id, true
}

// SignInMethods lists the ways the signed-in User can sign in.
// @Summary List sign-in methods
// @Tags Auth
// @Security BearerAuth
// @Success 200 {object} response.Envelope{data=presenter.SignInMethods}
// @Router /auth/identities [get]
func (h *Handler) SignInMethods(w http.ResponseWriter, r *http.Request) {
	id, ok := currentUserID(w, r)
	if !ok {
		return
	}
	methods, err := h.service.SignInMethods(r.Context(), id)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}
	out := presenter.SignInMethods{HasPassword: methods.HasPassword, Identities: make([]presenter.LinkedIdentity, 0, len(methods.Identities))}
	for _, item := range methods.Identities {
		out.Identities = append(out.Identities, presenter.LinkedIdentity{Provider: item.Provider, Email: item.Email, LinkedAt: item.LinkedAt})
	}
	_ = response.Data(w, http.StatusOK, out)
}

// UnlinkIdentity removes a linked account while another way to sign in remains.
// @Summary Unlink an account
// @Tags Auth
// @Security BearerAuth
// @Param provider path string true "Provider name"
// @Success 204
// @Failure 404 {object} response.ErrorEnvelope
// @Failure 409 {object} response.ErrorEnvelope
// @Router /auth/identities/{provider} [delete]
func (h *Handler) UnlinkIdentity(w http.ResponseWriter, r *http.Request) {
	id, ok := currentUserID(w, r)
	if !ok {
		return
	}
	provider := r.PathValue("provider")
	if !providerName.MatchString(provider) {
		response.Error(w, http.StatusNotFound, constant.ErrIdentityNotFound.Error())
		return
	}
	switch err := h.service.UnlinkIdentity(r.Context(), id, provider); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, constant.ErrIdentityNotFound):
		response.Error(w, http.StatusNotFound, err.Error())
	case errors.Is(err, constant.ErrLastSignInMethod):
		response.Error(w, http.StatusConflict, "Set a password before unlinking: it is the only way to sign in")
	default:
		response.Error(w, http.StatusInternalServerError, "internal server error")
	}
}

// SendPasswordLink mails the signed-in User a link to set or change the password.
// @Summary Send the set-password link
// @Tags Auth
// @Security BearerAuth
// @Success 204
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 429 {object} response.ErrorEnvelope
// @Failure 502 {object} response.ErrorEnvelope
// @Failure 503 {object} response.ErrorEnvelope
// @Router /auth/password/link [post]
func (h *Handler) SendPasswordLink(w http.ResponseWriter, r *http.Request) {
	id, ok := currentUserID(w, r)
	if !ok {
		return
	}
	switch err := h.service.SendPasswordLink(r.Context(), id); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, constant.ErrPasswordLinkTooSoon):
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

// CheckPasswordLink says whether a link is still usable, without using it up.
// @Summary Check a set-password link
// @Tags Auth
// @Security BearerAuth
// @Accept json
// @Param request body presenter.PasswordLinkRequest true "Link token"
// @Success 204
// @Failure 400 {object} response.ErrorEnvelope
// @Router /auth/password/check [post]
func (h *Handler) CheckPasswordLink(w http.ResponseWriter, r *http.Request) {
	id, ok := currentUserID(w, r)
	if !ok {
		return
	}
	var req presenter.PasswordLinkRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	switch err := h.service.CheckPasswordLink(r.Context(), id, req.Token); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, constant.ErrInvalidPasswordLink):
		response.Error(w, http.StatusBadRequest, err.Error())
	default:
		response.Error(w, http.StatusInternalServerError, "internal server error")
	}
}

// SetPassword sets or changes the password with a link mailed to the User.
// @Summary Set or change the password
// @Tags Auth
// @Security BearerAuth
// @Accept json
// @Param request body presenter.SetPasswordRequest true "Link token and new password"
// @Success 204
// @Failure 400 {object} response.ErrorEnvelope
// @Router /auth/password [post]
func (h *Handler) SetPassword(w http.ResponseWriter, r *http.Request) {
	id, ok := currentUserID(w, r)
	if !ok {
		return
	}
	var req presenter.SetPasswordRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	switch err := h.service.ResetPassword(r.Context(), id, req.Token, req.Password); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, constant.ErrInvalidPassword), errors.Is(err, constant.ErrInvalidPasswordLink):
		response.Error(w, http.StatusBadRequest, err.Error())
	default:
		response.Error(w, http.StatusInternalServerError, "internal server error")
	}
}
