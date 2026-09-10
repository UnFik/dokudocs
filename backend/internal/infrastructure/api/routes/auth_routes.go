package routes

import (
	appauth "backend/internal/application/auth/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	authhandler "backend/internal/presentation/auth/handler"
	"backend/internal/presentation/middleware"
)

func addAuthRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authHandler := authhandler.NewHandler(authUseCase, c.Validator)
	authRequired := middleware.ValidateToken(authUseCase)

	authGroup := f.Group("/auth")
	authGroup.Post("/login", authHandler.Login)
	authGroup.Post("/register", authHandler.Register)
	authGroup.Get("/me", authHandler.Me, authRequired)
}
