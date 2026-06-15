package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"backend/internal/infrastructure/runtime"
	"backend/internal/infrastructure/runtime/container"
)

func RunHTTPServer(ctx context.Context, cfg runtime.Config, c *container.Container) error {
	router := Routes(c, cfg)
	server := &http.Server{
		Addr: cfg.Addr,
		Handler: Chain(
			router,
			Timeout(cfg.ReadTimeout),
			CORS(cfg.AllowedOrigin),
			Recover(c.Logger),
			Logger(c.Logger),
		),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
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
	select {
	case sig := <-stop:
		c.Logger.Printf("received signal %s", sig)
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		c.Logger.Printf("context canceled")
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}
