package routes

import (
	appauth "backend/internal/application/auth/usecase"
	appuser "backend/internal/application/user/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/presentation/middleware"
	userhandler "backend/internal/presentation/user/handler"
)

func addUserRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := middleware.ValidateToken(authUseCase)

	userUseCase := appuser.NewUseCase(c.DB)
	userHandler := userhandler.NewHandler(userUseCase, c.Validator)

	userGroup := f.Group("/users", authRequired)
	userGroup.Get("/me/profile", userHandler.GetProfile)
	userGroup.Put("/me/profile", userHandler.UpdateProfile)
	userGroup.Get("/me/settings", userHandler.GetSettings)
	userGroup.Put("/me/settings", userHandler.UpdateSettings)
	userGroup.Get("", userHandler.SearchUsers)
}
