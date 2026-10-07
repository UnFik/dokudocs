package routes

import (
	appauth "backend/internal/application/auth/usecase"
	appcatalog "backend/internal/application/catalog"
	"backend/internal/config"
	catalogrepo "backend/internal/infrastructure/repository/catalog"
	"backend/internal/infrastructure/runtime/container"
	cataloghandler "backend/internal/presentation/catalog/handler"
	"backend/internal/presentation/middleware"
)

func addCatalogRoutes(f Router, c *container.Container, cfg config.Config) {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authRequired := middleware.ValidateToken(authUseCase)

	h := cataloghandler.New(appcatalog.NewService(catalogrepo.NewStore(c.DB)))
	group := f.Group("/catalog", authRequired)
	group.Get("", h.List)
	group.Post("/requests", h.Request)
}
