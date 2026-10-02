package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/url"
	"os"
	"time"

	"backend/database/seeders"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	databaseURL, err := testDatabaseURL()
	if err != nil {
		return err
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open test database: %w", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("connect to test database: %w", err)
	}
	if err := seeders.SeedAdminUser(ctx, db, seeders.AdminUser); err != nil {
		return fmt.Errorf("seed test user: %w", err)
	}
	return nil
}

func testDatabaseURL() (string, error) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		return "", fmt.Errorf("TEST_DATABASE_URL is required")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return "", fmt.Errorf("parse TEST_DATABASE_URL: %w", err)
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return "", fmt.Errorf("TEST_DATABASE_URL must use postgres")
	}
	if parsed.Path != "/dokudocs_test" {
		return "", fmt.Errorf("test seed refuses database %q; expected dokudocs_test", parsed.Path)
	}
	return databaseURL, nil
}
