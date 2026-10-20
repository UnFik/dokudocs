//go:build integration

package document

import (
	"context"
	"database/sql"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// An HTML document is plain text in content. A named revision keeps the page,
// and one restore puts it back, keeping the page it replaced as a revision of
// its own (ADR 0052).
func TestHTMLDocumentRestoreBringsBackThePageAndKeepsTheReplacedOne(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	ownerID := insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, ownerID)
	})
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed %q: %v", query, err)
		}
	}
	const first, second = "<p>first page</p>", "<p>second page</p>"
	mustExec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Html test', $2, $3)`, workspaceID, "html-"+workspaceID.String(), ownerID)
	mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, ownerID)
	mustExec(`INSERT INTO documents (id, workspace_id, title, type, content, author_id) VALUES ($1, $2, 'A page', 'html', $3, $4)`, documentID, workspaceID, first, ownerID)
	mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, documentID, ownerID)
	repo := NewRepository(database.NewSQLDB(db))

	named, err := repo.CreateNamedDocumentRevision(ctx, documentID, workspaceID, ownerID, "Before the edit")
	if err != nil {
		t.Fatalf("CreateNamedDocumentRevision(): %v", err)
	}
	if named.Content != first {
		t.Fatalf("named revision holds %q, want the first page", named.Content)
	}
	mustExec(`UPDATE documents SET content = $2 WHERE id = $1`, documentID, second)

	requestID := uuid.New()
	result, err := repo.RestoreDocumentRevision(ctx, documentID, named.ID, workspaceID, ownerID, requestID)
	if err != nil {
		t.Fatalf("RestoreDocumentRevision(): %v", err)
	}
	var content string
	if err := db.QueryRowContext(ctx, `SELECT content FROM documents WHERE id = $1`, documentID).Scan(&content); err != nil || content != first {
		t.Fatalf("page after restore = (%q, %v), want the first page", content, err)
	}
	var replaced int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM document_revisions WHERE document_id = $1 AND content = $2`, documentID, second).Scan(&replaced); err != nil || replaced != 1 {
		t.Fatalf("revisions holding the replaced page = (%d, %v), want exactly one", replaced, err)
	}

	again, err := repo.RestoreDocumentRevision(ctx, documentID, named.ID, workspaceID, ownerID, requestID)
	if err != nil || again.RevisionID != result.RevisionID {
		t.Fatalf("restore replay = (%+v, %v), want %+v", again, err, result)
	}
}
