package routes

import (
	"net/http"
	"strings"
	"time"

	appauth "backend/internal/application/auth/usecase"
	"backend/internal/config"
	repocontract "backend/internal/domain/contract/repository"
	usecasecontract "backend/internal/domain/contract/usecase"
	"backend/internal/infrastructure/google"
	"backend/internal/infrastructure/runtime/container"
	authhandler "backend/internal/presentation/auth/handler"
	"backend/internal/presentation/middleware"
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

// googleProvider is nil until both credentials are set. The redirect URL is
// derived from the public origin, so Google Console and the app cannot disagree.
func googleProvider(c *container.Container, cfg config.Config) repocontract.IdentityProvider {
	if cfg.GoogleClientID == "" || cfg.GoogleClientSecret == "" {
		return nil
	}
	if c.IdentityProvider != nil {
		return c.IdentityProvider
	}
	return google.NewProvider(
		cfg.GoogleClientID, cfg.GoogleClientSecret, strings.TrimRight(cfg.PublicAppURL, "/")+"/api/v1/auth/google/callback",
		google.WithEndpoints(google.Endpoints{Authorization: cfg.GoogleAuthURL, Token: cfg.GoogleTokenURL, JWKS: cfg.GoogleJWKSURL}),
	)
}

func addAuthRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL, appauth.WithMailer(c.Mailer, cfg.PublicAppURL), appauth.WithIdentityProvider("google", googleProvider(c, cfg)))
	authHandler := authhandler.NewHandler(authUseCase, c.Validator)
	authRequired := middleware.ValidateToken(authUseCase)

	authGroup := f.Group("/auth")
	credentials := rateLimit(cfg.RateLimitCredentialsPerMin, cfg)
	authGroup.Post("/login", authHandler.Login, credentials)
	authGroup.Post("/register", authHandler.Register, credentials)
	identityHandler := authhandler.NewIdentityHandler("google", "Google login belum dikonfigurasi", authUseCase, c.Validator, cfg.PublicAppURL)
	authGroup.Post("/google/start", identityHandler.Start, rateLimit(cfg.RateLimitGoogleStartPerMin, cfg))
	googleCallback := rateLimit(cfg.RateLimitGoogleCallbackPerMin, cfg)
	authGroup.Get("/google/callback", identityHandler.Callback, googleCallback)
	authGroup.Post("/google/exchange", identityHandler.Exchange, googleCallback)
	authGroup.Post("/email/resend", authHandler.ResendVerificationEmail, credentials, authRequired)
	authGroup.Post("/email/verify", authHandler.VerifyEmail, credentials)
	authGroup.Get("/identities", authHandler.SignInMethods, authRequired)
	authGroup.Delete("/identities/{provider}", authHandler.UnlinkIdentity, authRequired)
	authGroup.Post("/password", authHandler.SetPassword, credentials, authRequired)
	authGroup.Get("/me", authHandler.Me, authRequired)
}
