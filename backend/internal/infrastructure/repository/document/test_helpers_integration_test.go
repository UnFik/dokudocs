//go:build integration

package document

import (
	"context"
	"database/sql"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// plainDocumentJSON is a one-paragraph document in the editor's schema.
func plainDocumentJSON(paragraphID, runID uuid.UUID, text string) string {
	return `{"type":"doc","content":[{"type":"document","attrs":{"nodeID":"` + uuid.NewString() + `","bodyAttributes":"{}","bodyContent":""},"content":[` +
		`{"type":"paragraph","attrs":{"nodeID":"` + paragraphID.String() + `","bodyAttributes":"{}","bodyContent":""},"content":[` +
		`{"type":"run","attrs":{"nodeID":"` + runID.String() + `","bodyAttributes":"{}","bodyContent":""},"content":[{"type":"text","text":"` + text + `"}]}]}]}]}`
}

func seedRunDocument(t *testing.T, ctx context.Context, db *sql.DB) (workspaceID, documentID, ownerID, paragraphID, runID uuid.UUID, repo *Repository) {
	t.Helper()
	ownerID = insertAccessTestUser(t, ctx, db)
	workspaceID, documentID = uuid.New(), uuid.New()
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
	paragraphID, runID = uuid.New(), uuid.New()
	mustExec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Suggestion test', $2, $3)`, workspaceID, "suggestion-"+workspaceID.String(), ownerID)
	mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, ownerID)
	mustExec(`INSERT INTO documents (id, workspace_id, title, type, content, content_json, author_id) VALUES ($1, $2, 'Suggestion target', 'markdown', 'plain
', $3::jsonb, $4)`,
		documentID, workspaceID, plainDocumentJSON(paragraphID, runID, "plain"), ownerID)
	mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, documentID, ownerID)
	return workspaceID, documentID, ownerID, paragraphID, runID, NewRepository(database.NewSQLDB(db))
}

// seedJSONDocument inserts a Markdown document holding one paragraph with text, owned by owner.
func seedJSONDocument(ctx context.Context, db *sql.DB, workspaceID, documentID, owner uuid.UUID, text string) error {
	if _, err := db.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, content_json, author_id)
		VALUES ($1, $2, 'Seeded', 'markdown', $3, $4::jsonb, $5)
	`, documentID, workspaceID, text+"\n", plainDocumentJSON(uuid.New(), uuid.New(), text), owner); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, documentID, owner)
	return err
}
