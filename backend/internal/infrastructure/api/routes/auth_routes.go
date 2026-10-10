package routes

import (
	"net/http"
	"time"

	appauth "backend/internal/application/auth/usecase"
	"backend/internal/config"
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

func addAuthRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
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
	authGroup.Get("/me", authHandler.Me, authRequired)
}
