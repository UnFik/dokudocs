package routes

import (
	"time"

	"backend/internal/application/document/usecase"
	"backend/internal/application/htmlpage"
	"backend/internal/config"
	docrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/runtime/container"
)

// pageTicketTTL is how long the address of a page's frame stays good. The frame
// fetches the page once when it opens, so this only has to cover that.
const pageTicketTTL = 5 * time.Minute

func newPageService(c *container.Container, cfg config.Config) *htmlpage.Service {
	return htmlpage.NewService(usecase.NewUseCase(c.DB), docrepo.NewRepository(c.DB), htmlpage.NewSigner(cfg.JWTSecret, pageTicketTTL), cfg.ContentOrigin, cfg.PublicAppURL)
}
