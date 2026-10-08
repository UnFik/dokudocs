//go:build integration

package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"

	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func TestCreateKeepsTheContentJSONForTheCollaborationService(t *testing.T) {
	ctx := context.Background()
	sqlDB, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer sqlDB.Close()
	authorID := insertAccessTestUser(t, ctx, sqlDB)
	workspaceID := uuid.New()
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Content JSON', $2, $3)`,
		workspaceID, fmt.Sprintf("content-json-%s", workspaceID), authorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, authorID); err != nil {
		t.Fatalf("add member: %v", err)
	}
	t.Cleanup(func() {
		_, _ = sqlDB.ExecContext(context.Background(), `DELETE FROM documents WHERE workspace_id = $1`, workspaceID)
		_, _ = sqlDB.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = sqlDB.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = sqlDB.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, authorID)
	})

	repo := NewRepository(database.NewSQLDB(sqlDB))
	json1 := json.RawMessage(`{"type":"doc","content":[]}`)
	created, err := repo.CreateIdempotent(ctx, model.Document{
		WorkspaceID: workspaceID, Title: "From JSON", Type: "markdown", Content: "hello\n", ContentJSON: json1, AuthorID: authorID,
	}, nil, uuid.New())
	if err != nil {
		t.Fatalf("CreateIdempotent() = %v", err)
	}
	if created.Content != "hello\n" {
		t.Fatalf("content = %q, want the derived Markdown", created.Content)
	}
	got, err := repo.GetByID(ctx, created.ID, authorID)
	if err != nil || string(got.ContentJSON) == "" {
		t.Fatalf("GetByID() = (%q, %v), want the stored contentJSON", got.ContentJSON, err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(got.ContentJSON, &decoded); err != nil || decoded["type"] != "doc" {
		t.Fatalf("contentJSON = %s (%v), want the stored object", got.ContentJSON, err)
	}
	state, content, err := NewCollabStateStore(database.NewSQLDB(sqlDB)).LoadDocument(ctx, workspaceID, created.ID)
	if err != nil || state != nil || len(content) == 0 {
		t.Fatalf("LoadDocument() = (%v, %s, %v), want no state and the JSON", state, content, err)
	}
}
