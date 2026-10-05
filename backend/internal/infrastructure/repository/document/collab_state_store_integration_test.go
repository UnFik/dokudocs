//go:build integration

package document

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"

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
	if state, err := store.LoadState(ctx, documentID); err != nil || state != nil {
		t.Fatalf("LoadState() for a document with no state = (%v, %v), want (nil, nil)", state, err)
	}

	first := []byte{1, 2, 3}
	if err := store.StoreState(ctx, workspaceID, documentID, first, json.RawMessage(`{"type":"doc","content":[]}`)); err != nil {
		t.Fatalf("StoreState() = %v", err)
	}
	second := []byte{4, 5, 6, 7}
	if err := store.StoreState(ctx, workspaceID, documentID, second, json.RawMessage(`{"type":"doc","content":[{"type":"paragraph"}]}`)); err != nil {
		t.Fatalf("StoreState() the second time = %v", err)
	}
	state, err := store.LoadState(ctx, documentID)
	if err != nil || !bytes.Equal(state, second) {
		t.Fatalf("LoadState() = (%v, %v), want the second state", state, err)
	}
	var content string
	if err := sqlDB.QueryRowContext(ctx, `SELECT content_json::text FROM documents WHERE id = $1`, documentID).Scan(&content); err != nil {
		t.Fatalf("read content_json: %v", err)
	}
	if content != `{"type": "doc", "content": [{"type": "paragraph"}]}` {
		t.Fatalf("content_json = %s, want the second content", content)
	}

	// A document in another workspace is refused and nothing is written.
	if err := store.StoreState(ctx, otherWorkspaceID, documentID, []byte{9}, json.RawMessage(`{"type":"doc"}`)); err == nil {
		t.Fatal("StoreState() with the wrong workspace succeeded, want an error")
	}
	if state, _ := store.LoadState(ctx, documentID); !bytes.Equal(state, second) {
		t.Fatalf("state after the refused write = %v, want it unchanged", state)
	}
}
