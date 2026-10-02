//go:build integration

package user_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	"backend/internal/infrastructure/repository/user"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestFindByEmailAgainstDatabase(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		t.Fatalf("connect to test database: %v", err)
	}

	email := fmt.Sprintf("find-by-email-%s@example.invalid", uuid.NewString())
	accountNo := uuid.NewString()
	var userID uuid.UUID
	err = db.QueryRowContext(context.Background(), `
		INSERT INTO users (account_no, email, full_name)
		VALUES ($1, $2, 'Repository Integration Test')
		RETURNING id
	`, accountNo, email).Scan(&userID)
	if err != nil {
		t.Fatalf("create test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), "DELETE FROM users WHERE id = $1", userID)
	})

	repo := user.NewRepository(db)
	u, err := repo.FindByEmail(context.Background(), email)
	if err != nil {
		t.Fatalf("FindByEmail failed: %v", err)
	}

	if u.Email != email || u.ID != userID {
		t.Fatalf("FindByEmail() = (%s, %s), want (%s, %s)", u.ID, u.Email, userID, email)
	}
}
