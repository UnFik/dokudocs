//go:build integration

package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

const canvasOne = `{"version":1,"nodes":[{"id":"api","kind":"system","name":"API"}],"connections":[]}`
const canvasTwo = `{"version":1,"nodes":[{"id":"api","kind":"system","name":"API"},{"id":"db","kind":"system","name":"DB"}],"connections":[]}`

// seedArchitectureDocument turns the seeded Markdown document into an Architecture document holding canvas.
func seedArchitectureDocument(t *testing.T, ctx context.Context, db *sql.DB, canvas, summary string) (workspaceID, documentID, ownerID uuid.UUID, repo *Repository) {
	t.Helper()
	workspaceID, documentID, ownerID, _, _, repo = seedRunDocument(t, ctx, db)
	if _, err := db.ExecContext(ctx, `UPDATE documents SET type = 'architecture', content = $2, content_json = $3::jsonb WHERE id = $1`,
		documentID, summary, canvas); err != nil {
		t.Fatalf("make architecture document: %v", err)
	}
	return workspaceID, documentID, ownerID, repo
}

func openIntegrationDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func sameJSON(t *testing.T, got []byte, want string) bool {
	t.Helper()
	var a, b any
	if json.Unmarshal(got, &a) != nil || json.Unmarshal([]byte(want), &b) != nil {
		return false
	}
	ga, _ := json.Marshal(a)
	gb, _ := json.Marshal(b)
	return string(ga) == string(gb)
}

func TestReadingAnArchitectureDocumentGivesItsCanvas(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	_, documentID, ownerID, repo := seedArchitectureDocument(t, ctx, db, canvasOne, `System "API".`)
	got, err := repo.GetByID(ctx, documentID, ownerID)
	if err != nil {
		t.Fatalf("GetByID(): %v", err)
	}
	if got.Type != "architecture" || !sameJSON(t, got.ContentJSON, canvasOne) {
		t.Fatalf("GetByID() = (%s, %s), want the canvas", got.Type, got.ContentJSON)
	}
}

func TestRenamingAnArchitectureDocumentKeepsItsDerivedText(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	_, documentID, ownerID, repo := seedArchitectureDocument(t, ctx, db, canvasOne, `System "API".`)
	doc, err := repo.GetByID(ctx, documentID, ownerID)
	if err != nil {
		t.Fatalf("GetByID(): %v", err)
	}
	doc.Title = "Prod"
	doc.Content = ""
	if err := repo.UpdateAuthorized(ctx, doc, nil, ownerID); err != nil {
		t.Fatalf("UpdateAuthorized(): %v", err)
	}
	var title, content string
	if err := db.QueryRowContext(ctx, `SELECT title, content FROM documents WHERE id = $1`, documentID).Scan(&title, &content); err != nil {
		t.Fatalf("read: %v", err)
	}
	if title != "Prod" || content != `System "API".` {
		t.Fatalf("after rename = (%q, %q), want the new title and the same text", title, content)
	}
}

func TestRestoringAnArchitectureRevisionWritesTheCanvasBackAndDropsTheState(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	workspaceID, documentID, ownerID, repo := seedArchitectureDocument(t, ctx, db, canvasOne, `System "API".`)
	store := NewCollabStateStore(database.NewSQLDB(db))
	if err := store.StoreState(ctx, workspaceID, documentID, []byte{1}, json.RawMessage(canvasOne), `System "API".`, nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}
	named, err := repo.CreateNamedDocumentRevision(ctx, documentID, workspaceID, ownerID, "One system")
	if err != nil {
		t.Fatalf("CreateNamedDocumentRevision(): %v", err)
	}
	if err := store.StoreState(ctx, workspaceID, documentID, []byte{2}, json.RawMessage(canvasTwo), "System \"API\".\nSystem \"DB\".", nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}
	if _, err := repo.RestoreDocumentRevision(ctx, documentID, named.ID, workspaceID, ownerID, uuid.New()); err != nil {
		t.Fatalf("RestoreDocumentRevision(): %v", err)
	}
	state, content, err := store.LoadDocument(ctx, workspaceID, documentID)
	if err != nil || state != nil || !sameJSON(t, content, canvasOne) {
		t.Fatalf("after restore = (%v, %s, %v), want the first canvas and no state", state, content, err)
	}
}

func TestDuplicatingAnArchitectureDocumentCopiesTheCanvas(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	workspaceID, documentID, ownerID, repo := seedArchitectureDocument(t, ctx, db, canvasOne, `System "API".`)
	copyDoc, err := repo.DuplicateAuthorized(ctx, documentID, workspaceID, ownerID, uuid.New())
	if err != nil {
		t.Fatalf("DuplicateAuthorized(): %v", err)
	}
	if copyDoc.Type != "architecture" || !sameJSON(t, copyDoc.ContentJSON, canvasOne) || !strings.Contains(copyDoc.Content, "API") {
		t.Fatalf("copy = (%s, %s, %q), want the canvas and its text", copyDoc.Type, copyDoc.ContentJSON, copyDoc.Content)
	}
}
