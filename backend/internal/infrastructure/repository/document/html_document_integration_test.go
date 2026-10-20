//go:build integration

package document

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"backend/internal/application/htmlpage"
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

// An HTML document has no room, so ReadRoomHead gives nobody access to it; the
// Agent asks ReadPageAccess instead.
func TestReadPageAccessAnswersForADocumentWithoutARoom(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	ownerID, strangerID := insertAccessTestUser(t, ctx, db), insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		for _, id := range []uuid.UUID{ownerID, strangerID} {
			_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
		}
	})
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed %q: %v", query, err)
		}
	}
	mustExec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Html access', $2, $3)`, workspaceID, "html-access-"+workspaceID.String(), ownerID)
	mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, ownerID)
	mustExec(`INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility) VALUES ($1, $2, 'A page', 'html', '<p>x</p>', $3, 'private')`, documentID, workspaceID, ownerID)
	mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, documentID, ownerID)
	repo := NewRepository(database.NewSQLDB(db))

	head, err := repo.ReadRoomHead(ctx, workspaceID, documentID, []uuid.UUID{ownerID})
	if err != nil || head.DocumentType != "" || len(head.Access) != 0 {
		t.Fatalf("ReadRoomHead = (%+v, %v), want no room and no access for an html document", head, err)
	}
	owner, err := repo.ReadPageAccess(ctx, workspaceID, documentID, ownerID)
	if err != nil || !owner.CanRead || !owner.CanEdit {
		t.Fatalf("owner access = (%+v, %v), want read and edit", owner, err)
	}
	stranger, err := repo.ReadPageAccess(ctx, workspaceID, documentID, strangerID)
	if err != nil || stranger.CanRead || stranger.CanEdit {
		t.Fatalf("outsider access = (%+v, %v), want none", stranger, err)
	}
	mustExec(`UPDATE documents SET deleted_at = NOW() WHERE id = $1`, documentID)
	if _, err := repo.ReadPageAccess(ctx, workspaceID, documentID, ownerID); err == nil {
		t.Fatal("a trashed page still answered with access")
	}
}

// The RAG index reads the text extracted from a page when it was written: words in
// the page are found, code in it is not, and a rewrite makes the index stale.
func TestHTMLPageTextIsIndexedWithoutItsCodeAndGoesStaleWhenRewritten(t *testing.T) {
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
	page := `<html><head><title>Quarterly</title><script>var hiddenToken = 1</script></head><body><p>Revenue grew sharply</p></body></html>`
	mustExec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Html rag', $2, $3)`, workspaceID, "html-rag-"+workspaceID.String(), ownerID)
	mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, ownerID)
	mustExec(`INSERT INTO documents (id, workspace_id, title, type, content, content_json, author_id) VALUES ($1, $2, 'A page', 'html', $3, $4::jsonb, $5)`,
		documentID, workspaceID, page, string(htmlpage.IndexJSON(page)), ownerID)
	mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, documentID, ownerID)
	repo := NewRepository(database.NewSQLDB(db))

	result, err := repo.RebuildRAGIndex(ctx, documentID)
	if err != nil || result.ChunkCount != 1 {
		t.Fatalf("RebuildRAGIndex = (%+v, %v), want one chunk", result, err)
	}
	var text string
	if err := db.QueryRowContext(ctx, `SELECT text FROM rag_chunks WHERE document_id = $1`, documentID).Scan(&text); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "Revenue grew sharply") || strings.Contains(text, "hiddenToken") {
		t.Fatalf("indexed text = %q, want the words and not the script", text)
	}
	hits, err := repo.Search(ctx, workspaceID, ownerID, "sharply", 5)
	if err != nil || len(hits) != 1 || hits[0].ID != documentID {
		t.Fatalf("search = (%+v, %v), want the page found by its words", hits, err)
	}

	// A rewrite through the update path moves the body version, so the index is stale.
	doc, err := repo.GetByID(ctx, documentID, ownerID)
	if err != nil {
		t.Fatal(err)
	}
	doc.Content = `<html><body><p>Costs fell</p></body></html>`
	doc.ContentJSON = htmlpage.IndexJSON(doc.Content)
	if err := repo.UpdateAuthorized(ctx, doc, nil, ownerID); err != nil {
		t.Fatalf("UpdateAuthorized: %v", err)
	}
	var stale bool
	if err := db.QueryRowContext(ctx, `
		SELECT ri.indexed_body_version <> d.body_version FROM documents d JOIN rag_document_indexes ri ON ri.document_id = d.id WHERE d.id = $1
	`, documentID).Scan(&stale); err != nil || !stale {
		t.Fatalf("index stale = (%v, %v), want true after a rewrite", stale, err)
	}
	if _, err := repo.RebuildRAGIndex(ctx, documentID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, `SELECT text FROM rag_chunks WHERE document_id = $1`, documentID).Scan(&text); err != nil || !strings.Contains(text, "Costs fell") {
		t.Fatalf("reindexed text = (%q, %v), want the new page", text, err)
	}
}
