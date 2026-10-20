package routes

import (
	"net/http"
	"strings"

	"backend/internal/config"
	"backend/internal/infrastructure/runtime/container"
	dochandler "backend/internal/presentation/document/handler"
	"backend/internal/presentation/response"
)

// InitRoutes initializes and wires all route groups for the application.
func InitRoutes(c *container.Container, cfg config.Config) http.Handler {
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
	kit := newAgentKit(c, cfg)
	addDocumentRoutes(appGroup, c, cfg, kit)
	addCatalogRoutes(appGroup, c, cfg)
	addPushRoutes(appGroup, c, cfg)
	addAISettingsRoutes(appGroup, c, cfg)
	addAgentRoutes(mux, appGroup, c, cfg, kit)
	addCollabInternalRoutes(mux, c, cfg)
	pages := newPageService(c, cfg)
	mux.HandleFunc("GET /content/p/{token}", dochandler.NewPageHandler(pages).Serve)

	return contentHostGuard(pages.ContentHost(), mux)
}

// contentHostGuard keeps the content origin and the application apart. The frame of an
// HTML document is served from its own host (ADR 0052); that host answers the page
// route and nothing else, and the page route answers on no other host.
func contentHostGuard(contentHost string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		isPage := strings.HasPrefix(r.URL.Path, "/content/p/")
		onContentHost := contentHost != "" && r.Host == contentHost
		if isPage != onContentHost {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
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
