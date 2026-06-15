package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const migrationDir = "database/migrations"

type migration struct {
	Version  string
	Name     string
	UpPath   string
	DownPath string
}

func main() {
	if len(os.Args) < 2 {
		log.Fatal("usage: go run ./cmd/migrate <up|down|status>")
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := run(ctx, db, os.Args[1]); err != nil {
		log.Fatalf("run migrations: %v", err)
	}
}

func run(ctx context.Context, db *sql.DB, command string) error {
	if err := ensureMigrationTable(ctx, db); err != nil {
		return err
	}

	migrations, err := collectMigrations(migrationDir)
	if err != nil {
		return err
	}

	switch command {
	case "up":
		return migrateUp(ctx, db, migrations)
	case "down":
		return migrateDown(ctx, db, migrations)
	case "status":
		return migrationStatus(ctx, db, migrations)
	default:
		return fmt.Errorf("unknown command %q", command)
	}
}

func ensureMigrationTable(ctx context.Context, db *sql.DB) error {
	const statement = `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`
	_, err := db.ExecContext(ctx, statement)
	return err
}

func collectMigrations(dir string) ([]migration, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	byVersion := make(map[string]*migration)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		var direction string
		switch {
		case strings.HasSuffix(name, ".up.sql"):
			direction = "up"
		case strings.HasSuffix(name, ".down.sql"):
			direction = "down"
		default:
			continue
		}

		version, title, err := parseMigrationName(name, direction)
		if err != nil {
			return nil, err
		}
		item := byVersion[version]
		if item == nil {
			item = &migration{Version: version, Name: title}
			byVersion[version] = item
		}
		path := filepath.Join(dir, name)
		if direction == "up" {
			item.UpPath = path
		} else {
			item.DownPath = path
		}
	}

	migrations := make([]migration, 0, len(byVersion))
	for _, item := range byVersion {
		if item.UpPath == "" || item.DownPath == "" {
			return nil, fmt.Errorf("migration %s must have up and down files", item.Version)
		}
		migrations = append(migrations, *item)
	}
	sort.Slice(migrations, func(i, j int) bool { return migrations[i].Version < migrations[j].Version })
	return migrations, nil
}

func parseMigrationName(name, direction string) (string, string, error) {
	suffix := "." + direction + ".sql"
	base := strings.TrimSuffix(name, suffix)
	version, title, ok := strings.Cut(base, "_")
	if !ok || version == "" || title == "" {
		return "", "", fmt.Errorf("invalid migration filename %q", name)
	}
	return version, title, nil
}

func migrateUp(ctx context.Context, db *sql.DB, migrations []migration) error {
	applied, err := appliedVersions(ctx, db)
	if err != nil {
		return err
	}
	for _, item := range migrations {
		if applied[item.Version] {
			continue
		}
		if err := applyMigration(ctx, db, item, item.UpPath, true); err != nil {
			return err
		}
		log.Printf("OK %s_%s.up.sql", item.Version, item.Name)
	}
	return nil
}

func migrateDown(ctx context.Context, db *sql.DB, migrations []migration) error {
	applied, err := appliedVersions(ctx, db)
	if err != nil {
		return err
	}
	for i := len(migrations) - 1; i >= 0; i-- {
		item := migrations[i]
		if !applied[item.Version] {
			continue
		}
		if err := applyMigration(ctx, db, item, item.DownPath, false); err != nil {
			return err
		}
		log.Printf("OK %s_%s.down.sql", item.Version, item.Name)
		return nil
	}
	log.Print("no migrations to roll back")
	return nil
}

func migrationStatus(ctx context.Context, db *sql.DB, migrations []migration) error {
	applied, err := appliedVersions(ctx, db)
	if err != nil {
		return err
	}
	for _, item := range migrations {
		status := "pending"
		if applied[item.Version] {
			status = "applied"
		}
		log.Printf("%s %s_%s", status, item.Version, item.Name)
	}
	return nil
}

func appliedVersions(ctx context.Context, db *sql.DB) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	versions := make(map[string]bool)
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		versions[version] = true
	}
	return versions, rows.Err()
}

func applyMigration(ctx context.Context, db *sql.DB, item migration, path string, up bool) error {
	content, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err = tx.ExecContext(ctx, string(content)); err != nil {
		return err
	}
	if up {
		_, err = tx.ExecContext(ctx, "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", item.Version, item.Name)
	} else {
		_, err = tx.ExecContext(ctx, "DELETE FROM schema_migrations WHERE version = $1", item.Version)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
