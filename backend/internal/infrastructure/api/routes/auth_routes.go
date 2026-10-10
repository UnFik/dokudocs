package routes

import (
	"net/http"
	"time"

	appauth "backend/internal/application/auth/usecase"
	"backend/internal/config"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/runtime/container"
	authhandler "backend/internal/presentation/auth/handler"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"
)

// rateLimit limits each client to perMinute requests a minute; zero is no limit.
func rateLimit(perMinute int, cfg config.Config) Middleware {
	if perMinute <= 0 {
		return func(next http.Handler) http.Handler { return next }
	}
	return middleware.NewRateLimiter(perMinute, cfg.TrustProxyHeaders, time.Now).Middleware()
}

// signedIn is the guard for every route that needs a User: a valid token and,
// when the gate is on, a verified email. The auth routes that let an unverified
// User verify it use ValidateToken alone.
func signedIn(authUseCase usecasecontract.AuthUseCase, cfg config.Config) Middleware {
	validate := middleware.ValidateToken(authUseCase)
	verified := middleware.RequireVerifiedEmail(cfg.RequireEmailVerification)
	return func(next http.Handler) http.Handler { return validate(verified(next)) }
}

func addAuthRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL, appauth.WithMailer(c.Mailer, cfg.PublicAppURL))
	authHandler := authhandler.NewHandler(authUseCase, c.Validator)
	authRequired := middleware.ValidateToken(authUseCase)

	authGroup := f.Group("/auth")
	credentials := rateLimit(cfg.RateLimitCredentialsPerMin, cfg)
	authGroup.Post("/login", authHandler.Login, credentials)
	authGroup.Post("/register", authHandler.Register, credentials)
	authGroup.Post("/google/start", func(w http.ResponseWriter, r *http.Request) {
		if cfg.GoogleClientID == "" || cfg.GoogleClientSecret == "" {
			response.Error(w, http.StatusServiceUnavailable, "Google login belum dikonfigurasi")
			return
		}
		response.Error(w, http.StatusNotImplemented, "Google login belum tersedia")
	}, rateLimit(cfg.RateLimitGoogleStartPerMin, cfg))
	authGroup.Post("/email/resend", authHandler.ResendVerificationEmail, credentials, authRequired)
	authGroup.Post("/email/verify", authHandler.VerifyEmail, credentials)
	authGroup.Get("/me", authHandler.Me, authRequired)
}
