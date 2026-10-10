//go:build integration

package push

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func user(t *testing.T, db *sql.DB) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := db.QueryRowContext(context.Background(),
		`INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Push Test') RETURNING id`,
		uuid.NewString(), fmt.Sprintf("push-%s@example.invalid", uuid.NewString())).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

func TestTokensBelongToOneBrowserAtATime(t *testing.T) {
	ctx := context.Background()
	db := openDB(t)
	store := NewStore(database.NewSQLDB(db))
	alice, bob := user(t, db), user(t, db)
	token := "token-" + uuid.NewString()

	if err := store.Save(ctx, alice, token, "Firefox"); err != nil {
		t.Fatalf("Save(): %v", err)
	}
	if err := store.Save(ctx, alice, token, "Firefox"); err != nil {
		t.Fatalf("saving the same token again: %v", err)
	}
	if got, err := store.Tokens(ctx, alice); err != nil || len(got) != 1 || got[0] != token {
		t.Fatalf("Tokens(alice) = %v, %v, want the one token", got, err)
	}

	// The same browser signed in as Bob: the token moves to him.
	if err := store.Save(ctx, bob, token, "Firefox"); err != nil {
		t.Fatalf("Save() for another user: %v", err)
	}
	if got, _ := store.Tokens(ctx, alice); len(got) != 0 {
		t.Fatalf("Tokens(alice) = %v after the browser moved, want none", got)
	}
	if got, _ := store.Tokens(ctx, bob); len(got) != 1 {
		t.Fatalf("Tokens(bob) = %v, want the moved token", got)
	}

	// Alice cannot remove Bob's token.
	if err := store.Remove(ctx, alice, token); err != nil {
		t.Fatalf("Remove(): %v", err)
	}
	if got, _ := store.Tokens(ctx, bob); len(got) != 1 {
		t.Fatalf("Tokens(bob) = %v after Alice removed it, want it kept", got)
	}
	if err := store.Remove(ctx, bob, token); err != nil {
		t.Fatalf("Remove(): %v", err)
	}
	if got, _ := store.Tokens(ctx, bob); len(got) != 0 {
		t.Fatalf("Tokens(bob) = %v, want none", got)
	}

	// A token Firebase says is gone is dropped whoever holds it.
	if err := store.Save(ctx, alice, token, ""); err != nil {
		t.Fatal(err)
	}
	if err := store.Drop(ctx, token); err != nil {
		t.Fatalf("Drop(): %v", err)
	}
	if got, _ := store.Tokens(ctx, alice); len(got) != 0 {
		t.Fatalf("Tokens(alice) = %v after Drop, want none", got)
	}
}
