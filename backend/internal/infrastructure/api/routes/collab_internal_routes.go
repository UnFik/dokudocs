package routes

import (
	"net/http"

	appauth "backend/internal/application/auth/usecase"
	"backend/internal/config"
	docrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/runtime/container"
	collabhandler "backend/internal/presentation/collab/handler"
)

// addCollabInternalRoutes mounts the endpoints the collaboration service calls.
// They sit outside /api/v1 and are not for browsers: each request must carry the
// shared secret, and with no secret configured they answer 401 to everyone.
func addCollabInternalRoutes(mux *http.ServeMux, c *container.Container, cfg config.Config) {
	handler := collabhandler.NewInternalHandler(
		appauth.NewUseCase(c.DB, cfg.JWTSecret, cfg.AccessTokenTTL),
		docrepo.NewRepository(c.DB),
		docrepo.NewCollabStateStore(c.DB),
		cfg.CollabServiceSecret,
	).RequireVerifiedEmail(cfg.RequireEmailVerification)
	mux.Handle("/internal/collab/", handler)
}
