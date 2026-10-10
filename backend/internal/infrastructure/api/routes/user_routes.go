package routes

import (
	appauth "backend/internal/application/auth/usecase"
	appuser "backend/internal/application/user/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/assetstore"
	"backend/internal/infrastructure/runtime/container"
	userhandler "backend/internal/presentation/user/handler"
)

func addUserRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := signedIn(authUseCase, cfg)

	userUseCase := appuser.NewUseCase(c.DB, appuser.WithAvatarStore(assetstore.NewLocal(cfg.AssetDir)))
	userHandler := userhandler.NewHandler(userUseCase, c.Validator)

	f.Get("/avatars/{key}", userHandler.GetAvatar)

	userGroup := f.Group("/users", authRequired)
	userGroup.Put("/me/avatar", userHandler.UploadAvatar)
	userGroup.Delete("/me/avatar", userHandler.RemoveAvatar)
	userGroup.Get("/me/profile", userHandler.GetProfile)
	userGroup.Put("/me/profile", userHandler.UpdateProfile)
	userGroup.Get("/me/settings", userHandler.GetSettings)
	userGroup.Put("/me/settings", userHandler.UpdateSettings)
	userGroup.Get("", userHandler.SearchUsers)
}
