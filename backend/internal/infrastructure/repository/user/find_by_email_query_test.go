package user_test

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"backend/internal/infrastructure/repository/user"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestFindByEmailAgainstDatabase(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:15432/dokudocs?sslmode=disable"
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Skipf("cannot connect to postgres: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		t.Skipf("postgres ping failed: %v", err)
	}

	repo := user.NewRepository(db)
	u, err := repo.FindByEmail(context.Background(), "admin@example.com")
	if err != nil {
		t.Fatalf("FindByEmail failed: %v", err)
	}

	if u.Email != "admin@example.com" {
		t.Errorf("expected admin@example.com, got %s", u.Email)
	}
	if len(u.Roles) == 0 {
		t.Errorf("expected user to have roles, got %v", u.Roles)
	}
}
