//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPrivateProjectPlacementRequiresProjectEditorOrWorkspaceAdmin(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ownerID := insertAccessTestUser(t, ctx, db)
	actorID := insertAccessTestUser(t, ctx, db)
	workspaceID, sourceID := uuid.New(), uuid.New()
	sourceProjectID, targetProjectID := uuid.New(), uuid.New()
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Project Placement Test', $2, $3)
	`, workspaceID, fmt.Sprintf("project-placement-%s", workspaceID), ownerID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'member')
	`, workspaceID, ownerID, actorID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}
	for _, projectID := range []uuid.UUID{sourceProjectID, targetProjectID} {
		_, err = db.ExecContext(ctx, `
			INSERT INTO projects (id, workspace_id, name, visibility, created_by)
			VALUES ($1, $2, 'Private Project', 'private', $3)
		`, projectID, workspaceID, ownerID)
		if err != nil {
			t.Fatalf("create private project: %v", err)
		}
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, project_id, title, type, content, author_id, visibility)
		VALUES ($1, $2, $3, 'Private source', 'markdown', '# source', $4, 'private')
	`, sourceID, workspaceID, sourceProjectID, ownerID)
	if err != nil {
		t.Fatalf("create source document: %v", err)
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES
		($1, $2, 'owner'), ($1, $3, 'edit')
	`, sourceID, ownerID, actorID)
	if err != nil {
		t.Fatalf("create document grants: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM documents WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM projects WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE workspace_id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id IN ($1, $2)`, ownerID, actorID)
	})

	repo := NewRepository(database.NewSQLDB(db))
	if err := repo.Move(ctx, sourceID, workspaceID, actorID, &targetProjectID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("Move() without target project role = %v, want forbidden", err)
	}
	if _, err := repo.DuplicateAuthorized(ctx, sourceID, workspaceID, actorID, uuid.New()); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("DuplicateAuthorized() without source project role = %v, want forbidden", err)
	}
	if _, err := repo.Create(ctx, model.Document{
		WorkspaceID: workspaceID,
		ProjectID:   &targetProjectID,
		Title:       "Unauthorized placement",
		Type:        "markdown",
		AuthorID:    actorID,
	}, nil); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("Create() in private project without role = %v, want forbidden", err)
	}
	var currentProjectID uuid.UUID
	if err := db.QueryRowContext(ctx, `SELECT project_id FROM documents WHERE id = $1`, sourceID).Scan(&currentProjectID); err != nil {
		t.Fatalf("read source project after rejected move: %v", err)
	}
	if currentProjectID != sourceProjectID {
		t.Fatalf("source project after rejected move = %s, want %s", currentProjectID, sourceProjectID)
	}

	for _, projectID := range []uuid.UUID{sourceProjectID, targetProjectID} {
		_, err = db.ExecContext(ctx, `
			INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'editor')
		`, projectID, actorID)
		if err != nil {
			t.Fatalf("grant project editor: %v", err)
		}
	}
	if err := repo.Move(ctx, sourceID, workspaceID, actorID, &targetProjectID); err != nil {
		t.Fatalf("Move() with target editor role: %v", err)
	}
	if _, err := repo.DuplicateAuthorized(ctx, sourceID, workspaceID, actorID, uuid.New()); err != nil {
		t.Fatalf("DuplicateAuthorized() with project editor role: %v", err)
	}
	if _, err := repo.Create(ctx, model.Document{
		WorkspaceID: workspaceID,
		ProjectID:   &targetProjectID,
		Title:       "Authorized placement",
		Type:        "markdown",
		AuthorID:    actorID,
	}, nil); err != nil {
		t.Fatalf("Create() in private project with editor role: %v", err)
	}
}
