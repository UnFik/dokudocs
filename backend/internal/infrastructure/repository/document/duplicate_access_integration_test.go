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

func TestDuplicateRequiresCurrentReadAccessAndCreatesOwnerGrantAtomically(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	authorID := insertAccessTestUser(t, ctx, db)
	readerID := insertAccessTestUser(t, ctx, db)
	workspaceID, sourceID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Duplicate Access Test', $2, $3)
	`, workspaceID, fmt.Sprintf("duplicate-access-%s", workspaceID), authorID)
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
		INSERT INTO documents (id, workspace_id, title, type, content, author_id, tags, visibility)
		VALUES ($1, $2, 'Private source', 'markdown', '# source', $3, ARRAY['alpha', 'beta'], 'private')
	`, sourceID, workspaceID, authorID)
	if err != nil {
		t.Fatalf("create source document: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')
	`, sourceID, authorID)
	if err != nil {
		t.Fatalf("create source owner grant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM documents WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id IN ($1, $2)`, authorID, readerID)
	})

	repo := NewRepository(database.NewSQLDB(db))
	requestID := uuid.New()
	if _, err := repo.DuplicateAuthorized(ctx, sourceID, workspaceID, readerID, requestID); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("DuplicateAuthorized() without grant error = %v, want %v", err, constant.ErrDocumentNotFound)
	}
	var count int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM documents WHERE workspace_id = $1`, workspaceID).Scan(&count); err != nil {
		t.Fatalf("count documents after rejected duplicate: %v", err)
	}
	if count != 1 {
		t.Fatalf("rejected duplicate left %d documents, want 1", count)
	}

	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')
	`, sourceID, readerID); err != nil {
		t.Fatalf("grant source read access: %v", err)
	}
	clone, err := repo.DuplicateAuthorized(ctx, sourceID, workspaceID, readerID, requestID)
	if err != nil {
		t.Fatalf("DuplicateAuthorized() with view grant: %v", err)
	}
	replayedClone, err := repo.DuplicateAuthorized(ctx, sourceID, workspaceID, readerID, requestID)
	if err != nil || replayedClone.ID != clone.ID {
		t.Fatalf("DuplicateAuthorized() retry = (%s, %v), want same ID %s", replayedClone.ID, err, clone.ID)
	}
	var idempotentCopyCount int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*) FROM documents
		WHERE author_id = $1 AND creation_request_kind = 'duplicate' AND creation_request_id = $2
	`, readerID, requestID).Scan(&idempotentCopyCount); err != nil {
		t.Fatalf("count documents for idempotency key: %v", err)
	}
	if idempotentCopyCount != 1 {
		t.Fatalf("documents for idempotency key = %d, want 1", idempotentCopyCount)
	}
	if clone.ID == sourceID || clone.Title != "Copy of Private source" || clone.Content != "# source" || clone.AuthorID != readerID {
		t.Fatalf("duplicate = %#v, want copied source owned by reader", clone)
	}
	if len(clone.Tags) != 2 || clone.Tags[0] != "alpha" || clone.Tags[1] != "beta" {
		t.Fatalf("duplicate tags = %#v, want [alpha beta]", clone.Tags)
	}
	var ownerGrantCount int
	if err := db.QueryRowContext(ctx, `
		SELECT count(*) FROM document_accesses WHERE document_id = $1 AND user_id = $2 AND access_level = 'owner'
	`, clone.ID, readerID).Scan(&ownerGrantCount); err != nil {
		t.Fatalf("count duplicate owner grant: %v", err)
	}
	if ownerGrantCount != 1 {
		t.Fatalf("duplicate owner grants = %d, want 1", ownerGrantCount)
	}

	secondSourceID := uuid.New()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility)
		VALUES ($1, $2, 'Other source', 'markdown', '# other', $3, 'private')
	`, secondSourceID, workspaceID, authorID); err != nil {
		t.Fatalf("create second source document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')
	`, secondSourceID, readerID); err != nil {
		t.Fatalf("grant second source read access: %v", err)
	}
	if _, err := repo.DuplicateAuthorized(ctx, secondSourceID, workspaceID, readerID, requestID); !errors.Is(err, constant.ErrDocumentConflict) {
		t.Fatalf("DuplicateAuthorized() key reused for another source = %v, want %v", err, constant.ErrDocumentConflict)
	}
}
