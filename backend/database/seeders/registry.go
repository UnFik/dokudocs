package seeders

import (
	"context"
	"database/sql"
)

type Seeder func(context.Context, *sql.DB) error

var registry []Seeder

func Register(seed Seeder) {
	registry = append(registry, seed)
}

func Run(ctx context.Context, db *sql.DB) error {
	for _, seed := range registry {
		if err := seed(ctx, db); err != nil {
			return err
		}
	}
	return nil
}
