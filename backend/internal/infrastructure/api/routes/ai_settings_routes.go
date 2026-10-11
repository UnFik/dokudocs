package routes

import (
	appauth "backend/internal/application/auth/usecase"
	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	aihandler "backend/internal/presentation/aisettings/handler"
)

// addAISettingsRoutes serves the Superadmin's AI provider settings. Who may call them is
// decided by the service, from the database, on every request.
func addAISettingsRoutes(f Router, c *container.Container, cfg config.Config) {
	if c.AISettings == nil {
		return
	}
	authRequired := signedIn(appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL), cfg)
	h := aihandler.New(c.AISettings)
	group := f.Group("/platform/ai", authRequired)
	group.Get("", h.Overview)
	group.Get("/changes", h.Changes)
	group.Put("/{purpose}", h.Save)
	group.Post("/{purpose}/test", h.Test)
}
