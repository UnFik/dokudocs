//go:build integration

package document

import (
	"context"
	"database/sql"
	"fmt"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestListTrashOnlyReturnsItemsTheActorCanReadOrManage(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	authorID := insertAccessTestUser(t, ctx, db)
	memberID := insertAccessTestUser(t, ctx, db)
	adminID := insertAccessTestUser(t, ctx, db)
	workspaceID := uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Trash Access Test', $2, $3)
	`, workspaceID, fmt.Sprintf("trash-access-%s", workspaceID), authorID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'admin')
	`, workspaceID, authorID, memberID, adminID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	docIDs := map[string]uuid.UUID{
		"private-hidden":    uuid.New(),
		"private-owned":     uuid.New(),
		"workspace-visible": uuid.New(),
		"private-granted":   uuid.New(),
	}
	for name, visibility := range map[string]string{
		"private-hidden":    "private",
		"private-owned":     "private",
		"workspace-visible": "workspace",
		"private-granted":   "private",
	} {
		if _, err := db.ExecContext(ctx, `
			INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility, deleted_at, deleted_by)
			VALUES ($1, $2, $3, 'markdown', '', $4, $5::document_visibility, now(), $4)
		`, docIDs[name], workspaceID, name, authorID, visibility); err != nil {
			t.Fatalf("create trashed %s document: %v", name, err)
		}
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES
		($1, $2, 'owner'), ($3, $4, 'view'), ($5, $6, 'owner')
	`, docIDs["private-hidden"], authorID, docIDs["private-granted"], memberID, docIDs["private-owned"], memberID); err != nil {
		t.Fatalf("create document grants: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM documents WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id IN ($1, $2, $3)`, authorID, memberID, adminID)
	})

	repo := NewRepository(database.NewSQLDB(db))
	assertTrashIDs := func(actorID uuid.UUID, visible ...string) {
		t.Helper()
		items, err := repo.ListTrash(ctx, workspaceID, actorID)
		if err != nil {
			t.Fatalf("ListTrash() error = %v", err)
		}
		got := make(map[uuid.UUID]bool, len(items))
		for _, item := range items {
			got[item.DocID] = true
		}
		for _, name := range visible {
			if !got[docIDs[name]] {
				t.Errorf("ListTrash() omitted %q for actor %s", name, actorID)
			}
		}
		if len(got) != len(visible) {
			t.Errorf("ListTrash() returned %d items for actor %s, want %d", len(got), actorID, len(visible))
		}
	}
	assertTrashIDs(memberID, "private-owned")
	assertTrashIDs(adminID, "private-hidden", "private-owned", "workspace-visible", "private-granted")
}
