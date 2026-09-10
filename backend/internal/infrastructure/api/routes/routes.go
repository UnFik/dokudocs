package routes

import (
	"net/http"

	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/presentation/response"
)

// InitRoutes initializes and wires all route groups for the application.
func InitRoutes(c *container.Container, cfg config.Config) http.Handler {
	mux := http.NewServeMux()

	// Base API group /api/v1
	appGroup := NewGroup(mux, "/api/v1")

	// Health check
	appGroup.Get("/health", Health)

	// Register modular route groups
	addAuthRoutes(appGroup, c, cfg)
	addUserRoutes(appGroup, c, cfg)
	addWorkspaceRoutes(appGroup, c, cfg)
	addProjectRoutes(appGroup, c, cfg)
	addDocumentRoutes(appGroup, c, cfg)

	return mux
}

// Health handles health check requests.
func Health(w http.ResponseWriter, _ *http.Request) {
	_ = response.Data(w, http.StatusOK, map[string]string{"status": "ok"})
}
