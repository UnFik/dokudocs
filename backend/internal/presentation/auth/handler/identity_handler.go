package handler

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"backend/constant"
	"backend/internal/application/auth/dto"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/validator"
	"backend/internal/presentation/auth/presenter"
	"backend/internal/presentation/request"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

const bindingMaxAge = 600

// IdentityHandler serves the sign-in and link endpoints of one outside provider.
type IdentityHandler struct {
	provider  string
	service   usecasecontract.AccountUseCase
	validate  *validator.Validator
	appURL    string
	appOrigin string
	secure    bool
	// notConfigured is the message for a provider with no credentials.
	notConfigured string
}

func NewIdentityHandler(provider, notConfigured string, service usecasecontract.AccountUseCase, validate *validator.Validator, appURL string) *IdentityHandler {
	appURL = strings.TrimRight(appURL, "/")
	parsed, _ := url.Parse(appURL)
	origin := ""
	if parsed != nil && parsed.Scheme != "" && parsed.Host != "" {
		origin = parsed.Scheme + "://" + parsed.Host
	}
	return &IdentityHandler{
		provider: provider, service: service, validate: validate, notConfigured: notConfigured,
		appURL: appURL, appOrigin: origin, secure: strings.HasPrefix(appURL, "https://"),
	}
}

func (h *IdentityHandler) cookieName() string { return "dokudocs_" + h.provider + "_binding" }
func (h *IdentityHandler) cookiePath() string { return "/api/v1/auth/" + h.provider }

func (h *IdentityHandler) setBinding(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name: h.cookieName(), Value: value, Path: h.cookiePath(), MaxAge: maxAge,
		HttpOnly: true, Secure: h.secure, SameSite: http.SameSiteLaxMode,
	})
}

func (h *IdentityHandler) binding(r *http.Request) string {
	if c, err := r.Cookie(h.cookieName()); err == nil {
		return c.Value
	}
	return ""
}

// sameOrigin lets a request through when it names no Origin (not a browser) or
// the app's own.
func (h *IdentityHandler) sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || (h.appOrigin != "" && origin == h.appOrigin)
}

func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

// Start begins a sign-in, or a link when the caller sends a bearer token.
// @Summary Start signing in with an outside provider
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body presenter.StartIdentityRequest false "Where to return"
// @Success 200 {object} response.Envelope{data=presenter.StartIdentityResponse}
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 403 {object} response.ErrorEnvelope
// @Failure 503 {object} response.ErrorEnvelope
// @Router /auth/google/start [post]
func (h *IdentityHandler) Start(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.sameOrigin(r) {
		response.Error(w, http.StatusForbidden, "request origin is not allowed")
		return
	}
	var req presenter.StartIdentityRequest
	if r.ContentLength != 0 {
		if err := response.DecodeJSON(r, &req); err != nil {
			response.Error(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}
	start := dto.IdentityStart{Provider: h.provider, Redirect: req.Redirect}
	if header := r.Header.Get("Authorization"); header != "" {
		token, ok := strings.CutPrefix(header, "Bearer ")
		user, err := h.service.VerifyToken(strings.TrimSpace(token))
		id, perr := uuid.Parse(user.ID)
		if !ok || err != nil || perr != nil {
			response.Error(w, http.StatusUnauthorized, constant.ErrInvalidToken.Error())
			return
		}
		start.LinkUserID = &id
	}
	started, err := h.service.StartIdentity(r.Context(), start)
	if err != nil {
		if errors.Is(err, constant.ErrIdentityProviderNotSet) {
			response.Error(w, http.StatusServiceUnavailable, h.notConfigured)
			return
		}
		response.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}
	h.setBinding(w, started.Binding, bindingMaxAge)
	_ = response.Data(w, http.StatusOK, presenter.StartIdentityResponse{AuthorizationURL: started.AuthorizationURL})
}

// Callback is where the provider sends the browser back. It always redirects to
// the app, with a code to exchange or a short error.
// @Summary Provider callback
// @Tags Auth
// @Success 302
// @Router /auth/google/callback [get]
func (h *IdentityHandler) Callback(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	query := r.URL.Query()
	outcome := h.service.FinishIdentity(r.Context(), dto.IdentityCallback{
		Provider: h.provider, State: query.Get("state"), Binding: h.binding(r),
		Code: query.Get("code"), ProviderError: query.Get("error"),
	})

	target := url.Values{}
	path := "/auth/callback"
	switch {
	case outcome.Linking:
		path = outcome.Redirect
		if outcome.Error != "" {
			target.Set("link_error", outcome.Error)
		} else {
			target.Set("linked", h.provider)
		}
	case outcome.Error != "":
		target.Set("error", outcome.Error)
	default:
		target.Set("code", outcome.ExchangeCode)
	}
	if outcome.ExchangeCode == "" {
		h.setBinding(w, "", -1)
	}
	location := h.appURL + path
	separator := "?"
	if strings.Contains(path, "?") {
		separator = "&"
	}
	w.Header().Set("Location", location+separator+target.Encode())
	w.WriteHeader(http.StatusFound)
}

// Exchange trades the one-time code for a token.
// @Summary Exchange the sign-in code for a token
// @Tags Auth
// @Accept json
// @Produce json
// @Param request body presenter.ExchangeIdentityRequest true "Code from the callback redirect"
// @Success 200 {object} response.Envelope{data=presenter.ExchangeIdentityResponse}
// @Failure 400 {object} response.ErrorEnvelope
// @Router /auth/google/exchange [post]
func (h *IdentityHandler) Exchange(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.sameOrigin(r) {
		response.Error(w, http.StatusForbidden, "request origin is not allowed")
		return
	}
	var req presenter.ExchangeIdentityRequest
	if err := response.DecodeJSON(r, &req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if err := h.validate.Struct(req); err != nil {
		response.Error(w, http.StatusBadRequest, request.ValidationTitle(err))
		return
	}
	exchanged, err := h.service.ExchangeIdentity(r.Context(), req.Code, h.binding(r))
	if err != nil {
		if errors.Is(err, constant.ErrOAuthTransactionNotFound) {
			response.Error(w, http.StatusBadRequest, "sign-in code is invalid or has expired")
			return
		}
		response.Error(w, http.StatusInternalServerError, "internal server error")
		return
	}
	h.setBinding(w, "", -1)
	user := exchanged.Login.User
	_ = response.Data(w, http.StatusOK, presenter.ExchangeIdentityResponse{
		AccessToken: exchanged.Login.AccessToken,
		Redirect:    exchanged.Redirect,
		User: presenter.ResponseUser{
			ID: user.ID, AccountNo: user.AccountNo, Email: user.Email, Role: user.Role, Exp: user.Exp,
			EmailVerified: user.EmailVerified,
		},
	})
}
