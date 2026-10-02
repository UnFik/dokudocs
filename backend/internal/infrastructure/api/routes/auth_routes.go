package routes

import (
	"net/http"

	appauth "backend/internal/application/auth/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	authhandler "backend/internal/presentation/auth/handler"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"
)

func addAuthRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authHandler := authhandler.NewHandler(authUseCase, c.Validator)
	authRequired := middleware.ValidateToken(authUseCase)

	authGroup := f.Group("/auth")
	authGroup.Post("/login", authHandler.Login)
	authGroup.Post("/register", authHandler.Register)
	authGroup.Post("/google/start", func(w http.ResponseWriter, r *http.Request) {
		if cfg.GoogleClientID == "" || cfg.GoogleClientSecret == "" {
			response.Error(w, http.StatusServiceUnavailable, "Google login belum dikonfigurasi")
			return
		}
		response.Error(w, http.StatusNotImplemented, "Google login belum tersedia")
	})
	authGroup.Get("/me", authHandler.Me, authRequired)
}
