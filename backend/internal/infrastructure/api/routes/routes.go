package routes

import (
	"context"
	"net/http"

	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/presentation/response"
)

// InitRoutes initializes and wires all route groups for the application.
func InitRoutes(c *container.Container, cfg config.Config) http.Handler {
	handler, _ := InitRoutesWithShutdown(c, cfg)
	return handler
}

func InitRoutesWithShutdown(c *container.Container, cfg config.Config) (http.Handler, func(context.Context) error) {
	mux := http.NewServeMux()

	// Base API group /api/v1
	appGroup := NewGroup(mux, "/api/v1")

	// Health check
	appGroup.Get("/health", Health)

	// Documentation routes
	addDocsRoutes(mux)

	// Register modular route groups
	addAuthRoutes(appGroup, c, cfg)
	addUserRoutes(appGroup, c, cfg)
	addWorkspaceRoutes(appGroup, c, cfg)
	addProjectRoutes(appGroup, c, cfg)
	shutdownCollaboration := addDocumentRoutes(appGroup, c, cfg)
	addCollabInternalRoutes(mux, c, cfg)

	return mux, shutdownCollaboration
}

// Health handles health check requests.
// @Summary Health check
// @Description Returns service health status
// @Tags Health
// @Produce json
// @Success 200 {object} response.Envelope
// @Router /health [get]
func Health(w http.ResponseWriter, _ *http.Request) {
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "ok"})
}
