package main

import (
	"context"
	"time"

	"backend/database/seeders"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/postgres"
	"backend/internal/infrastructure/runtime"
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
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := seeders.Run(ctx, db.Raw()); err != nil {
		log.Fatalf("run seeders: %v", err)
	}
	log.Printf("seeders completed")
}
