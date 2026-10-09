package postgres

import (
	"context"
	"time"

	"backend/internal/config"
	"backend/internal/infrastructure/database"

	"backend/internal/infrastructure/tracing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func Open(cfg config.Config) (database.DB, error) {
	connConfig, err := pgx.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	connConfig.Tracer = tracing.QueryTracer()
	db := stdlib.OpenDB(*connConfig)
	db.SetMaxOpenConns(cfg.DBMaxOpenConns)
	db.SetMaxIdleConns(cfg.DBMaxIdleConns)
	db.SetConnMaxLifetime(cfg.DBConnMaxLifetime)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return database.NewSQLDB(db), nil
}
