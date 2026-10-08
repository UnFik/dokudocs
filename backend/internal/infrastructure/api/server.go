package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend/internal/config"
	"backend/internal/infrastructure/api/routes"
	"backend/internal/infrastructure/middleware"
	"backend/internal/infrastructure/runtime/container"
)

// Routes initializes application routes via routes package.
func Routes(c *container.Container, cfg config.Config) http.Handler {
	return routes.InitRoutes(c, cfg)
}

func RunHTTPServer(ctx context.Context, cfg config.Config, c *container.Container) error {
	handler := routes.InitRoutes(c, cfg)
	handler = middleware.Logger(c.Logger)(handler)
	handler = middleware.Recover(c.Logger)(handler)
	handler = middleware.CORS(cfg.AllowedOrigin)(handler)
	handler = middleware.TimeoutWithRAG(cfg.ReadTimeout, cfg.RAGRequestTimeout)(handler)
	writeTimeout := cfg.WriteTimeout
	if ragTimeout := cfg.RAGRequestTimeout + 2*time.Second; ragTimeout > writeTimeout {
		writeTimeout = ragTimeout
	}

	server := &http.Server{
		Addr:         cfg.Addr,
		Handler:      handler,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: writeTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}
	errCh := make(chan error, 1)
	go func() {
		c.Logger.Printf("api listening on %s", cfg.Addr)
		errCh <- server.ListenAndServe()
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	var serveErr error
	select {
	case sig := <-stop:
		c.Logger.Printf("received signal %s", sig)
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			serveErr = err
		}
	case <-ctx.Done():
		c.Logger.Printf("context canceled")
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	return errors.Join(serveErr, server.Shutdown(shutdownCtx))
}
