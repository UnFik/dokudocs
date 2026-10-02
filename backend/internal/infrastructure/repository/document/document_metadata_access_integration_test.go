//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestDocumentMetadataMutationsRequireCurrentReadAccess(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	authorID := insertAccessTestUser(t, ctx, db)
	readerID := insertAccessTestUser(t, ctx, db)
	workspaceID, docID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Metadata Access Test', $2, $3)
	`, workspaceID, fmt.Sprintf("metadata-access-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, authorID, readerID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility)
		VALUES ($1, $2, 'Private metadata target', 'markdown', '', $3, 'private')
	`, docID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("create private document: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')
	`, docID, authorID)
	if err != nil {
		t.Fatalf("create document owner grant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM documents WHERE id = $1`, docID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id IN ($1, $2)`, authorID, readerID)
	})

	repo := NewRepository(database.NewSQLDB(db))
	t.Run("record view", func(t *testing.T) {
		err := repo.RecordView(ctx, docID, workspaceID, readerID)
		if !errors.Is(err, constant.ErrDocumentNotFound) {
			t.Fatalf("RecordView() error = %v, want %v", err, constant.ErrDocumentNotFound)
		}
		var count int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM document_views WHERE document_id = $1 AND user_id = $2`, docID, readerID).Scan(&count); err != nil {
			t.Fatalf("count views: %v", err)
		}
		if count != 0 {
			t.Fatalf("RecordView() wrote %d rows, want 0", count)
		}
	})
	t.Run("toggle star", func(t *testing.T) {
		starred, err := repo.ToggleStar(ctx, docID, workspaceID, readerID)
		if !errors.Is(err, constant.ErrDocumentNotFound) {
			t.Fatalf("ToggleStar() error = %v, want %v", err, constant.ErrDocumentNotFound)
		}
		if starred {
			t.Fatal("ToggleStar() reported star created after rejecting access")
		}
		var count int
		if err := db.QueryRowContext(ctx, `SELECT count(*) FROM document_stars WHERE document_id = $1 AND user_id = $2`, docID, readerID).Scan(&count); err != nil {
			t.Fatalf("count stars: %v", err)
		}
		if count != 0 {
			t.Fatalf("ToggleStar() wrote %d rows, want 0", count)
		}
	})
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')
	`, docID, readerID); err != nil {
		t.Fatalf("grant read access: %v", err)
	}
	if err := repo.RecordView(ctx, docID, workspaceID, readerID); err != nil {
		t.Fatalf("RecordView() with current view grant: %v", err)
	}
	starred, err := repo.ToggleStar(ctx, docID, workspaceID, readerID)
	if err != nil || !starred {
		t.Fatalf("ToggleStar() with current view grant = (%t, %v), want (true, nil)", starred, err)
	}
}
