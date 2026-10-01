//go:build integration

package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestMarkdownASTMigrationRoundTripsSchemaAndEnforcesTreeKeys(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	down, err := os.ReadFile("../../database/migrations/20260928000001_add_markdown_ast_collaboration.down.sql")
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	up, err := os.ReadFile("../../database/migrations/20260928000001_add_markdown_ast_collaboration.up.sql")
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin schema fixture transaction: %v", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, string(down)); err != nil {
		t.Fatalf("roll back AST migration: %v", err)
	}
	if _, err := tx.ExecContext(ctx, string(up)); err != nil {
		t.Fatalf("apply AST migration: %v", err)
	}

	var nodesTable, stateTable, receiptsTable sql.NullString
	if err := tx.QueryRowContext(ctx, `
		SELECT to_regclass('document_nodes'), to_regclass('document_collab_states'), to_regclass('document_command_receipts')
	`).Scan(&nodesTable, &stateTable, &receiptsTable); err != nil {
		t.Fatalf("check AST tables: %v", err)
	}
	if !nodesTable.Valid || !stateTable.Valid || !receiptsTable.Valid {
		t.Fatalf("AST tables missing: nodes=%v state=%v receipts=%v", nodesTable, stateTable, receiptsTable)
	}

	var userID uuid.UUID
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'AST migration test') RETURNING id
	`, uuid.NewString(), fmt.Sprintf("ast-migration-%s@example.invalid", uuid.NewString())).Scan(&userID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	workspaceID := uuid.New()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'AST migration test', $2, $3)
	`, workspaceID, "ast-migration-"+workspaceID.String(), userID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	firstDocumentID, secondDocumentID := uuid.New(), uuid.New()
	for _, documentID := range []uuid.UUID{firstDocumentID, secondDocumentID} {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, title, type, author_id)
			VALUES ($1, $2, 'AST migration test', 'markdown', $3)
		`, documentID, workspaceID, userID); err != nil {
			t.Fatalf("create document: %v", err)
		}
	}
	firstRootID, secondRootID := uuid.New(), uuid.New()
	for _, root := range []struct{ documentID, nodeID uuid.UUID }{{firstDocumentID, firstRootID}, {secondDocumentID, secondRootID}} {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_nodes (document_id, node_id, sibling_order, node_type)
			VALUES ($1, $2, 0, 'document')
		`, root.documentID, root.nodeID); err != nil {
			t.Fatalf("insert root node: %v", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE documents SET root_node_id = $2 WHERE id = $1`, root.documentID, root.nodeID); err != nil {
			t.Fatalf("set document root: %v", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `SET CONSTRAINTS ALL IMMEDIATE`); err != nil {
		t.Fatalf("validate deferred AST constraints: %v", err)
	}

	if _, err := tx.ExecContext(ctx, `SAVEPOINT invalid_parent`); err != nil {
		t.Fatalf("create savepoint: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO document_nodes (document_id, parent_id, sibling_order, node_type)
		VALUES ($1, $2, 1, 'paragraph')
	`, firstDocumentID, secondRootID); err == nil {
		t.Fatal("cross-document parent reference was accepted")
	}
	if _, err := tx.ExecContext(ctx, `ROLLBACK TO SAVEPOINT invalid_parent`); err != nil {
		t.Fatalf("rollback invalid parent check: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `RELEASE SAVEPOINT invalid_parent`); err != nil {
		t.Fatalf("release savepoint: %v", err)
	}
}
