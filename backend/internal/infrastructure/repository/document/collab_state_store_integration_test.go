//go:build integration

package document

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"

	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func TestCollabStateStoreKeepsStateAndContentTogether(t *testing.T) {
	sqlDB, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer sqlDB.Close()
	db := database.NewSQLDB(sqlDB)
	ctx := context.Background()

	authorID := insertAccessTestUser(t, ctx, sqlDB)
	workspaceID, otherWorkspaceID, documentID := uuid.New(), uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{workspaceID, otherWorkspaceID} {
		if _, err := sqlDB.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'State Store Test', $2, $3)`,
			id, fmt.Sprintf("state-store-%s", id), authorID); err != nil {
			t.Fatalf("create workspace: %v", err)
		}
	}
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, content, author_id) VALUES ($1, $2, 'State', 'markdown', '', $3)`,
		documentID, workspaceID, authorID); err != nil {
		t.Fatalf("create document: %v", err)
	}
	t.Cleanup(func() {
		_, _ = sqlDB.ExecContext(ctx, `DELETE FROM documents WHERE id = $1`, documentID)
		_, _ = sqlDB.ExecContext(ctx, `DELETE FROM workspaces WHERE id = ANY($1)`, []uuid.UUID{workspaceID, otherWorkspaceID})
	})

	store := NewCollabStateStore(db)
	if state, content, err := store.LoadDocument(ctx, workspaceID, documentID); err != nil || state != nil || content != nil {
		t.Fatalf("LoadDocument() for a document with nothing = (%v, %s, %v), want nils", state, content, err)
	}
	if _, _, err := store.LoadDocument(ctx, otherWorkspaceID, documentID); err == nil {
		t.Fatal("LoadDocument() with the wrong workspace succeeded, want not found")
	}

	first := []byte{1, 2, 3}
	if err := store.StoreState(ctx, workspaceID, documentID, first, json.RawMessage(`{"type":"doc","content":[]}`), "", nil); err != nil {
		t.Fatalf("StoreState() = %v", err)
	}
	second := []byte{4, 5, 6, 7}
	if err := store.StoreState(ctx, workspaceID, documentID, second, json.RawMessage(`{"type":"doc","content":[{"type":"paragraph"}]}`), "second text\n", nil); err != nil {
		t.Fatalf("StoreState() the second time = %v", err)
	}
	state, loaded, err := store.LoadDocument(ctx, workspaceID, documentID)
	if err != nil || !bytes.Equal(state, second) || len(loaded) == 0 {
		t.Fatalf("LoadDocument() = (%v, %s, %v), want the second state and content", state, loaded, err)
	}
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, authorID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}
	editorID := insertAccessTestUser(t, ctx, sqlDB)
	if err := store.StoreState(ctx, workspaceID, documentID, second, json.RawMessage(`{"type":"doc","content":[{"type":"paragraph"}]}`), "second text\n", nil, collaboration.WithUpdatedBy(editorID)); err != nil {
		t.Fatalf("StoreState() with an editor = %v", err)
	}
	var updatedBy uuid.UUID
	if err := sqlDB.QueryRowContext(ctx, `SELECT updated_by FROM documents WHERE id = $1`, documentID).Scan(&updatedBy); err != nil || updatedBy != editorID {
		t.Fatalf("updated_by = %v (%v), want %s", updatedBy, err, editorID)
	}
	shown, err := NewRepository(db).GetByID(ctx, documentID, authorID)
	if err != nil || shown.UpdatedBy == nil || shown.UpdatedBy.ID != editorID {
		t.Fatalf("GetByID().UpdatedBy = %+v (%v), want the editor", shown.UpdatedBy, err)
	}
	var content string
	if err := sqlDB.QueryRowContext(ctx, `SELECT content_json::text FROM documents WHERE id = $1`, documentID).Scan(&content); err != nil {
		t.Fatalf("read content_json: %v", err)
	}
	if content != `{"type": "doc", "content": [{"type": "paragraph"}]}` {
		t.Fatalf("content_json = %s, want the second content", content)
	}

	var markdown string
	if err := sqlDB.QueryRowContext(ctx, `SELECT content FROM documents WHERE id = $1`, documentID).Scan(&markdown); err != nil {
		t.Fatalf("read content: %v", err)
	}
	if markdown != "second text\n" {
		t.Fatalf("content = %q, want the derived Markdown", markdown)
	}

	// A document in another workspace is refused and nothing is written.
	if err := store.StoreState(ctx, otherWorkspaceID, documentID, []byte{9}, json.RawMessage(`{"type":"doc"}`), "", nil); err == nil {
		t.Fatal("StoreState() with the wrong workspace succeeded, want an error")
	}
	if state, _, _ := store.LoadDocument(ctx, workspaceID, documentID); !bytes.Equal(state, second) {
		t.Fatalf("state after the refused write = %v, want it unchanged", state)
	}
}
