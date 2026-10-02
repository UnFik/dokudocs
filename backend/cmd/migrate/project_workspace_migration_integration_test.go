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

func TestProjectWorkspaceMigrationPreservesValidLegacyRowsAndRejectsMismatches(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	downSQL, err := os.ReadFile("../../database/migrations/20260927000001_enforce_document_project_workspace.down.sql")
	if err != nil {
		t.Fatalf("read down migration: %v", err)
	}
	upSQL, err := os.ReadFile("../../database/migrations/20260927000001_enforce_document_project_workspace.up.sql")
	if err != nil {
		t.Fatalf("read up migration: %v", err)
	}

	t.Run("keeps valid legacy project association", func(t *testing.T) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatalf("begin migration transaction: %v", err)
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx, string(downSQL)); err != nil {
			t.Fatalf("restore pre-migration schema: %v", err)
		}
		workspaceID, projectID, docID := createProjectWorkspaceMigrationFixture(t, ctx, tx, false)
		if _, err := tx.ExecContext(ctx, `SET CONSTRAINTS ALL IMMEDIATE`); err != nil {
			t.Fatalf("flush deferred fixture constraints: %v", err)
		}
		if _, err := tx.ExecContext(ctx, string(upSQL)); err != nil {
			t.Fatalf("apply project/workspace migration: %v", err)
		}
		var gotProjectID uuid.UUID
		var gotWorkspaceID uuid.UUID
		if err := tx.QueryRowContext(ctx, `
			SELECT project_id, workspace_id FROM documents WHERE id = $1
		`, docID).Scan(&gotProjectID, &gotWorkspaceID); err != nil {
			t.Fatalf("read legacy document after migration: %v", err)
		}
		if gotProjectID != projectID || gotWorkspaceID != workspaceID {
			t.Fatalf("migration changed legacy association to (%s, %s)", gotProjectID, gotWorkspaceID)
		}
	})

	t.Run("rejects mismatched legacy rows", func(t *testing.T) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatalf("begin migration transaction: %v", err)
		}
		defer tx.Rollback()
		if _, err := tx.ExecContext(ctx, string(downSQL)); err != nil {
			t.Fatalf("restore pre-migration schema: %v", err)
		}
		createProjectWorkspaceMigrationFixture(t, ctx, tx, true)
		if _, err := tx.ExecContext(ctx, `SET CONSTRAINTS ALL IMMEDIATE`); err != nil {
			t.Fatalf("flush deferred fixture constraints: %v", err)
		}
		if _, err := tx.ExecContext(ctx, string(upSQL)); err == nil {
			t.Fatal("migration succeeded with project/workspace mismatch")
		}
	})
}

func createProjectWorkspaceMigrationFixture(t *testing.T, ctx context.Context, tx *sql.Tx, mismatch bool) (uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	var userID uuid.UUID
	email := fmt.Sprintf("migration-author-%s@example.invalid", uuid.NewString())
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Migration Test') RETURNING id
	`, uuid.NewString(), email).Scan(&userID); err != nil {
		t.Fatalf("create fixture author: %v", err)
	}
	workspaceID := uuid.New()
	projectWorkspaceID := workspaceID
	_, err := tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Migration Test', $2, $3)
	`, workspaceID, fmt.Sprintf("migration-%s", workspaceID), userID)
	if err != nil {
		t.Fatalf("create fixture workspace: %v", err)
	}
	if mismatch {
		projectWorkspaceID = uuid.New()
		_, err = tx.ExecContext(ctx, `
			INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Migration Other', $2, $3)
		`, projectWorkspaceID, fmt.Sprintf("migration-other-%s", projectWorkspaceID), userID)
		if err != nil {
			t.Fatalf("create other workspace: %v", err)
		}
	}
	projectID, docID := uuid.New(), uuid.New()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO projects (id, workspace_id, name, created_by) VALUES ($1, $2, 'Migration Project', $3)
	`, projectID, projectWorkspaceID, userID)
	if err != nil {
		t.Fatalf("create fixture project: %v", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id)
		VALUES ($1, $2, $3, 'Legacy document', 'markdown', 'legacy body', $4)
	`, docID, workspaceID, projectID, userID)
	if err != nil {
		t.Fatalf("create legacy document: %v", err)
	}
	return workspaceID, projectID, docID
}
