package routes

import (
	"net/http"

	appauth "backend/internal/application/auth/usecase"
	"backend/internal/infrastructure/runtime"
	"backend/internal/infrastructure/runtime/container"
	authhandler "backend/internal/presentation/auth/handler"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"
)

type Route struct {
	Method  string
	Path    string
	Handler http.Handler
}

func Routes(c *container.Container, cfg runtime.Config) []Route {
	authUseCase := appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL)
	authHandler := authhandler.NewHandler(authUseCase, c.Validator)
	return []Route{
		{Method: http.MethodGet, Path: "/api/v1/health", Handler: http.HandlerFunc(Health)},
		{Method: http.MethodPost, Path: "/api/v1/auth/login", Handler: http.HandlerFunc(authHandler.Login)},
		{Method: http.MethodGet, Path: "/api/v1/auth/me", Handler: middleware.ValidateToken(authUseCase)(http.HandlerFunc(authHandler.Me))},
	}
}

func Health(w http.ResponseWriter, _ *http.Request) {
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "ok"})
}
