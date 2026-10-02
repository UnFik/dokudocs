//go:build integration

package seeders

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestEnsureSeedDocumentOwnerGrant(t *testing.T) {
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
	authorID, currentOwnerID := uuid.New(), uuid.New()
	workspaceID, fallbackDocID, preservedDocID := uuid.New(), uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM documents WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id IN ($1, $2)`, authorID, currentOwnerID)
	})
	for _, userID := range []uuid.UUID{authorID, currentOwnerID} {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO users (id, account_no, email, full_name)
			VALUES ($1, $2, $3, 'Seeder owner test')
		`, userID, uuid.NewString(), fmt.Sprintf("%s@example.invalid", userID)); err != nil {
			t.Fatalf("create user: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Seeder owner test', $2, $3)
	`, workspaceID, "seed-owner-"+workspaceID.String(), authorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	for _, docID := range []uuid.UUID{fallbackDocID, preservedDocID} {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, title, type, content, author_id)
			VALUES ($1, $2, 'Seeder owner test', 'markdown', '', $3)
		`, docID, workspaceID, authorID); err != nil {
			t.Fatalf("create document: %v", err)
		}
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level)
		VALUES ($1, $2, 'view'), ($3, $4, 'owner')
	`, fallbackDocID, authorID, preservedDocID, currentOwnerID); err != nil {
		t.Fatalf("create existing grants: %v", err)
	}
	if err := ensureSeedDocumentOwnerGrant(ctx, db, fallbackDocID.String(), authorID.String()); err != nil {
		t.Fatalf("ensure fallback owner: %v", err)
	}
	if err := ensureSeedDocumentOwnerGrant(ctx, db, preservedDocID.String(), authorID.String()); err != nil {
		t.Fatalf("preserve explicit owner: %v", err)
	}
	for _, test := range []struct {
		docID uuid.UUID
		want  uuid.UUID
	}{{fallbackDocID, authorID}, {preservedDocID, currentOwnerID}} {
		var got uuid.UUID
		if err := db.QueryRowContext(ctx, `
			SELECT user_id FROM document_accesses WHERE document_id = $1 AND access_level = 'owner'
		`, test.docID).Scan(&got); err != nil {
			t.Fatalf("read owner grant for %s: %v", test.docID, err)
		}
		if got != test.want {
			t.Errorf("owner for %s = %s, want %s", test.docID, got, test.want)
		}
	}
}
