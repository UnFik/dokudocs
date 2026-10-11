//go:build integration

package project

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestSoftDeleteKeepsDocumentsAsDraftsWithoutWideningAccess(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
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

	ownerID := insertProjectVisibilityUser(t, ctx, tx)
	workspaceID := uuid.New()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Soft Delete Test', $2, $3)
	`, workspaceID, fmt.Sprintf("soft-delete-%s", workspaceID), ownerID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, workspaceID, ownerID); err != nil {
		t.Fatalf("create workspace member: %v", err)
	}

	privateProjectID, openProjectID := uuid.New(), uuid.New()
	for _, p := range []struct {
		id         uuid.UUID
		visibility string
	}{{privateProjectID, "private"}, {openProjectID, "workspace"}} {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO projects (id, workspace_id, name, visibility, created_by)
			VALUES ($1, $2, $3, $4::project_visibility, $5)
		`, p.id, workspaceID, "Project "+p.visibility, p.visibility, ownerID); err != nil {
			t.Fatalf("create %s project: %v", p.visibility, err)
		}
	}

	docs := map[string]uuid.UUID{}
	for _, d := range []struct {
		key        string
		projectID  uuid.UUID
		visibility string
	}{
		{"private-inherit", privateProjectID, "inherit"},
		{"open-inherit", openProjectID, "inherit"},
		{"private-explicit", openProjectID, "private"},
	} {
		id := uuid.New()
		docs[d.key] = id
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, visibility)
			VALUES ($1, $2, $3, $4, 'markdown', '', $5, $6::document_visibility)
		`, id, workspaceID, d.projectID, d.key, ownerID, d.visibility); err != nil {
			t.Fatalf("create document %s: %v", d.key, err)
		}
	}

	repo := &Repository{db: tx, tx: projectFixtureDB{Queryer: tx}}
	for _, id := range []uuid.UUID{privateProjectID, openProjectID} {
		if err := repo.SoftDelete(ctx, id, workspaceID, ownerID); err != nil {
			t.Fatalf("SoftDelete(%s): %v", id, err)
		}
	}

	want := map[string]string{
		"private-inherit":  "private",
		"open-inherit":     "workspace",
		"private-explicit": "private",
	}
	for key, visibility := range want {
		var projectID sql.NullString
		var isDraft bool
		var got string
		if err := tx.QueryRowContext(ctx, `
			SELECT project_id::text, is_draft, visibility::text FROM documents WHERE id = $1
		`, docs[key]).Scan(&projectID, &isDraft, &got); err != nil {
			t.Fatalf("read document %s: %v", key, err)
		}
		if projectID.Valid || !isDraft {
			t.Errorf("%s: project_id=%v is_draft=%v, want detached draft", key, projectID, isDraft)
		}
		if got != visibility {
			t.Errorf("%s: visibility = %q, want %q", key, got, visibility)
		}
	}
}
