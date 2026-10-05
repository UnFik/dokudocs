//go:build integration

package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// Restoring writes the revision's JSON and Markdown back and drops the Yjs
// state, so the collaboration service rebuilds the state from the JSON.
func TestRestoreRevisionWritesTheRevisionBackAndDropsTheState(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, paragraphID, runID, repo := seedRunDocument(t, ctx, db)
	store := NewCollabStateStore(database.NewSQLDB(db))
	if err := store.StoreState(ctx, workspaceID, documentID, []byte{1}, json.RawMessage(plainDocumentJSON(paragraphID, runID, "plain")), "plain\n", nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}
	named, err := repo.CreateNamedDocumentRevision(ctx, documentID, workspaceID, ownerID, "Before")
	if err != nil {
		t.Fatalf("CreateNamedDocumentRevision(): %v", err)
	}
	if err := store.StoreState(ctx, workspaceID, documentID, []byte{2}, json.RawMessage(plainDocumentJSON(paragraphID, runID, "changed")), "changed\n", nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}

	result, err := repo.RestoreDocumentRevision(ctx, documentID, named.ID, workspaceID, ownerID, uuid.New())
	if err != nil {
		t.Fatalf("RestoreDocumentRevision(): %v", err)
	}
	if result.SourceRevisionID != named.ID {
		t.Fatalf("result = %+v, want the source revision", result)
	}
	var content string
	var contentJSON []byte
	if err := db.QueryRowContext(ctx, `SELECT content, content_json FROM documents WHERE id = $1`, documentID).Scan(&content, &contentJSON); err != nil {
		t.Fatalf("read document: %v", err)
	}
	if content != "plain\n" || !json.Valid(contentJSON) || string(contentJSON) == "" {
		t.Fatalf("document after restore = (%q, %s), want the revision's content", content, contentJSON)
	}
	state, loaded, err := store.LoadDocument(ctx, workspaceID, documentID)
	if err != nil || state != nil || len(loaded) == 0 {
		t.Fatalf("LoadDocument() after restore = (%v, %s, %v), want JSON and no state", state, loaded, err)
	}

	// The same request ID answers with the same restore.
	requestID := uuid.New()
	first, err := repo.RestoreDocumentRevision(ctx, documentID, named.ID, workspaceID, ownerID, requestID)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	again, err := repo.RestoreDocumentRevision(ctx, documentID, named.ID, workspaceID, ownerID, requestID)
	if err != nil || again.RevisionID != first.RevisionID {
		t.Fatalf("restore replay = (%+v, %v), want %+v", again, err, first)
	}
}

func TestDuplicateCopiesTheContentAndJSONWithoutAState(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, _, repo := seedRunDocument(t, ctx, db)
	copyDoc, err := repo.DuplicateAuthorized(ctx, documentID, workspaceID, ownerID, uuid.New())
	if err != nil {
		t.Fatalf("DuplicateAuthorized(): %v", err)
	}
	if copyDoc.Content != "plain\n" || len(copyDoc.ContentJSON) == 0 {
		t.Fatalf("copy = (%q, %s), want the Markdown and the JSON", copyDoc.Content, copyDoc.ContentJSON)
	}
}
