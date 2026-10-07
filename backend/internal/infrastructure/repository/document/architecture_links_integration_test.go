//go:build integration

package document

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// TestStoringACanvasRecordsWhichDocumentsItsElementsLinkTo covers the projection the
// "Used in" list reads: links are kept only to Markdown, DBML and Mermaid documents
// of the same workspace, and a later store replaces them.
func TestStoringACanvasRecordsWhichDocumentsItsElementsLinkTo(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	workspaceID, archID, ownerID, repo := seedArchitectureDocument(t, ctx, db, canvasOne, "")
	spec := uuid.New()
	if err := seedJSONDocument(ctx, db, workspaceID, spec, ownerID, "Order API"); err != nil {
		t.Fatalf("seed spec: %v", err)
	}
	other := uuid.New()
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, content, author_id) VALUES ($1, $2, 'Schema', 'dbdiagram', 'Table a {}', $3)`, other, workspaceID, ownerID); err != nil {
		t.Fatalf("seed dbml: %v", err)
	}
	_, foreign, foreignOwner, _, _, _ := seedRunDocument(t, ctx, db)
	_ = foreignOwner
	canvas := fmt.Sprintf(`{"version":1,"nodes":[{"id":"api","kind":"system","name":"Backend Order","links":["%s","%s","%s","%s"]},{"id":"db","kind":"system","name":"DB","links":[]}],"connections":[{"id":"c1","source":"api","target":"db","protocol":"db-connection","links":["%s"]}]}`,
		spec, other, foreign, archID, other)
	store := NewCollabStateStore(database.NewSQLDB(db))
	if err := store.StoreState(ctx, workspaceID, archID, []byte{1}, json.RawMessage(canvas), "summary", nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}
	rows := map[string]bool{}
	result, err := db.QueryContext(ctx, `SELECT element_id, element_kind, element_name, document_id FROM architecture_document_links WHERE architecture_id = $1`, archID)
	if err != nil {
		t.Fatalf("read links: %v", err)
	}
	for result.Next() {
		var element, kind, name string
		var document uuid.UUID
		if err := result.Scan(&element, &kind, &name, &document); err != nil {
			t.Fatalf("scan: %v", err)
		}
		rows[fmt.Sprintf("%s/%s/%s/%s", element, kind, name, document)] = true
	}
	want := map[string]bool{
		fmt.Sprintf("api/system/Backend Order/%s", spec):          true,
		fmt.Sprintf("api/system/Backend Order/%s", other):         true,
		fmt.Sprintf("c1/connection/Backend Order → DB/%s", other): true,
	}
	if len(rows) != len(want) {
		t.Fatalf("links = %v, want %v (no foreign document, no Architecture document)", rows, want)
	}
	for key := range want {
		if !rows[key] {
			t.Fatalf("links = %v, missing %s", rows, key)
		}
	}

	uses, err := repo.ArchitectureUses(ctx, workspaceID, spec, ownerID)
	if err != nil || len(uses) != 1 || uses[0].ArchitectureID != archID || uses[0].ElementID != "api" || uses[0].ElementName != "Backend Order" {
		t.Fatalf("ArchitectureUses() = (%+v, %v)", uses, err)
	}

	if err := store.StoreState(ctx, workspaceID, archID, []byte{2}, json.RawMessage(canvasOne), "summary", nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}
	var count int
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM architecture_document_links WHERE architecture_id = $1`, archID).Scan(&count)
	if count != 0 {
		t.Fatalf("after the links were removed from the canvas: %d rows, want 0", count)
	}
}

func TestUsedInListsOnlyCanvasesTheReaderMayOpen(t *testing.T) {
	ctx := context.Background()
	db := openIntegrationDB(t)
	workspaceID, archID, ownerID, repo := seedArchitectureDocument(t, ctx, db, canvasOne, "")
	spec := uuid.New()
	if err := seedJSONDocument(ctx, db, workspaceID, spec, ownerID, "spec"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	reader := insertAccessTestUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, reader) })
	for q, args := range map[string][]any{
		`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`:      {workspaceID, reader},
		`UPDATE documents SET visibility = 'private' WHERE id = $1`:                                  {archID},
		`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`: {spec, reader},
	} {
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	canvas := fmt.Sprintf(`{"version":1,"nodes":[{"id":"api","kind":"system","name":"API","links":["%s"]}],"connections":[]}`, spec)
	if err := NewCollabStateStore(database.NewSQLDB(db)).StoreState(ctx, workspaceID, archID, []byte{1}, json.RawMessage(canvas), "", nil); err != nil {
		t.Fatalf("StoreState(): %v", err)
	}
	uses, err := repo.ArchitectureUses(ctx, workspaceID, spec, reader)
	if err != nil || len(uses) != 0 {
		t.Fatalf("a reader without access to the private canvas sees %+v (%v), want nothing", uses, err)
	}
	if uses, err := repo.ArchitectureUses(ctx, workspaceID, spec, ownerID); err != nil || len(uses) != 1 {
		t.Fatalf("the owner sees %+v (%v), want the canvas", uses, err)
	}
}
