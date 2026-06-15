package api

import (
	routepkg "backend/internal/infrastructure/api/routes"
	"backend/internal/infrastructure/runtime"
	"backend/internal/infrastructure/runtime/container"
	"net/http"
)

func Routes(c *container.Container, cfg runtime.Config) http.Handler {
	return NewRouter(routepkg.Routes(c, cfg))
}
