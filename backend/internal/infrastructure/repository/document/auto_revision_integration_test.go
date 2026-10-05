//go:build integration

package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"backend/internal/infrastructure/database"
)

// Every store of a document rewrites one rolling revision instead of adding one.
func TestStoringADocumentKeepsOneRollingRevision(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, _, paragraphID, runID, _ := seedRunDocument(t, ctx, db)
	store := NewCollabStateStore(database.NewSQLDB(db))
	for _, text := range []string{"one", "two", "three"} {
		if err := store.StoreState(ctx, workspaceID, documentID, []byte{1}, json.RawMessage(plainDocumentJSON(paragraphID, runID, text)), text+"\n", nil); err != nil {
			t.Fatalf("StoreState(): %v", err)
		}
	}
	var count int
	var content string
	var bodyVersion int64
	if err := db.QueryRowContext(ctx, `
		SELECT (SELECT COUNT(*) FROM document_revisions WHERE document_id = $1), content, body_version
		FROM document_revisions WHERE document_id = $1 ORDER BY version_number DESC LIMIT 1
	`, documentID).Scan(&count, &content, &bodyVersion); err != nil {
		t.Fatalf("read revisions: %v", err)
	}
	if count != 1 || content != "three\n" || bodyVersion != 4 {
		t.Fatalf("revisions = (%d, %q, v%d), want one rolling revision holding the last store at body_version 4", count, content, bodyVersion)
	}
}
