package main

import (
	"context"

	"backend/internal/infrastructure/api"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/postgres"
	"backend/internal/infrastructure/runtime"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"
)

func main() {
	log := logger.New()
	cfg, err := runtime.LoadConfig()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	db, err := postgres.Open(cfg)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()
	c := container.New(db, log, validator.New())
	if err := api.RunHTTPServer(context.Background(), cfg, c); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
