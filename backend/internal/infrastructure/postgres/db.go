package postgres

import (
	"context"
	"database/sql"
	"time"

	"backend/internal/config"
	"backend/internal/infrastructure/database"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func Open(cfg config.Config) (database.DB, error) {
	db, err := sql.Open("pgx", cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(10)
	db.SetConnMaxLifetime(30 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return database.NewSQLDB(db), nil
}
