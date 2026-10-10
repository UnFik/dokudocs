package routes

import (
	appauth "backend/internal/application/auth/usecase"
	"backend/internal/config"
	pushrepo "backend/internal/infrastructure/repository/push"
	"backend/internal/infrastructure/runtime/container"
	pushhandler "backend/internal/presentation/push/handler"
)

func addPushRoutes(f Router, c *container.Container, cfg config.Config) {
	authRequired := signedIn(appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL), cfg)

	var web *pushhandler.WebConfig
	if c.Push != nil {
		web = &pushhandler.WebConfig{
			APIKey: cfg.FirebaseWebAPIKey, AppID: cfg.FirebaseWebAppID, SenderID: cfg.FirebaseWebSenderID,
			ProjectID: c.PushProjectID, VAPIDKey: cfg.FirebaseVAPIDKey,
		}
	}
	h := pushhandler.New(pushrepo.NewStore(c.DB), web)
	f.Get("/push/config", h.Config, authRequired)
	tokens := f.Group("/users/me/push-tokens", authRequired)
	tokens.Post("", h.Register)
	tokens.Delete("", h.Unregister)
}
