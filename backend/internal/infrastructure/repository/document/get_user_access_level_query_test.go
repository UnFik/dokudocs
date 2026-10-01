//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"backend/constant"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestGetUserAccessLevelReturnsAccessNotFoundWhenGrantIsMissing(t *testing.T) {
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer tx.Rollback()

	authorID := insertAccessTestUser(t, ctx, tx)
	readerID := insertAccessTestUser(t, ctx, tx)
	workspaceID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Access Lookup Test', $2, $3)
	`, workspaceID, fmt.Sprintf("access-lookup-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	docID := uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, author_id)
		VALUES ($1, $2, 'Access Lookup Test', 'markdown', '', $3)
	`, docID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("create document: %v", err)
	}

	level, err := (&Repository{db: tx}).GetUserAccessLevel(ctx, docID, readerID)
	if !errors.Is(err, constant.ErrAccessNotFound) {
		t.Fatalf("GetUserAccessLevel() error = %v, want %v", err, constant.ErrAccessNotFound)
	}
	if level != "" {
		t.Fatalf("GetUserAccessLevel() level = %q, want empty", level)
	}
}
