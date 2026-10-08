//go:build integration

package document

import (
	"context"
	"database/sql"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// TestReadRoomHeadReportsEachRolesAccess checks the batched room read for every role.
func TestReadRoomHeadReportsEachRolesAccess(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	owner := insertAccessTestUser(t, ctx, db)
	viewer, editor, commenter := insertAccessTestUser(t, ctx, db), insertAccessTestUser(t, ctx, db), insertAccessTestUser(t, ctx, db)
	plainMember, outsider := insertAccessTestUser(t, ctx, db), insertAccessTestUser(t, ctx, db)
	projectViewer, projectEditor := insertAccessTestUser(t, ctx, db), insertAccessTestUser(t, ctx, db)
	workspaceID, projectID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		for _, id := range []uuid.UUID{owner, viewer, editor, commenter, plainMember, outsider, projectViewer, projectEditor} {
			_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, id)
		}
		_ = db.Close()
	})
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	mustExec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Room head test', $2, $3)`, workspaceID, "room-head-"+workspaceID.String(), owner)
	for user, role := range map[uuid.UUID]string{
		owner: "owner", viewer: "member", editor: "member", commenter: "guest",
		plainMember: "member", projectViewer: "member", projectEditor: "member",
	} {
		mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)`, workspaceID, user, role)
	}
	mustExec(`INSERT INTO projects (id, workspace_id, name, visibility, created_by) VALUES ($1, $2, 'Private project', 'private', $3)`, projectID, workspaceID, owner)
	mustExec(`INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'viewer'), ($1, $3, 'editor')`, projectID, projectViewer, projectEditor)

	newDocument := func(visibility string, inProject bool) uuid.UUID {
		documentID := uuid.New()
		if err := seedJSONDocument(ctx, db, workspaceID, documentID, owner, "text"); err != nil {
			t.Fatalf("seed document: %v", err)
		}
		mustExec(`UPDATE documents SET visibility = $2::document_visibility WHERE id = $1`, documentID, visibility)
		if inProject {
			mustExec(`UPDATE documents SET project_id = $2 WHERE id = $1`, documentID, projectID)
		}
		mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view'), ($1, $3, 'edit'), ($1, $4, 'comment')`,
			documentID, viewer, editor, commenter)
		mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`, documentID, outsider)
		return documentID
	}

	reader := NewRepository(database.NewSQLDB(db))
	users := []uuid.UUID{owner, viewer, editor, commenter, plainMember, outsider, projectViewer, projectEditor}
	for name, documentID := range map[string]uuid.UUID{
		"private document":           newDocument("private", false),
		"workspace document":         newDocument("workspace", false),
		"inherit in private project": newDocument("inherit", true),
		"workspace in project":       newDocument("workspace", true),
	} {
		head, err := reader.ReadRoomHead(ctx, workspaceID, documentID, users)
		if err != nil {
			t.Fatalf("%s: ReadRoomHead(): %v", name, err)
		}
		if name == "private document" {
			want := map[uuid.UUID]RoomAccessWant{
				owner: {true, true, true}, viewer: {true, false, false}, editor: {true, true, true},
				commenter: {true, false, true}, plainMember: {false, false, false}, outsider: {false, false, false},
			}
			for user, expected := range want {
				got := head.Access[user]
				if got.CanRead != expected.read || got.CanEdit != expected.edit || got.CanSuggest != expected.suggest {
					t.Fatalf("%s: user %s access = %+v, want %+v", name, user, got, expected)
				}
			}
		}
		if outsiderAccess := head.Access[uuid.New()]; outsiderAccess.CanRead {
			t.Fatalf("%s: an unknown user can read", name)
		}
	}
}

type RoomAccessWant struct{ read, edit, suggest bool }

func TestReadRoomHeadReportsNoAccessForATrashedOrForeignDocument(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, _, reader := seedRunDocument(t, ctx, db)
	if _, err := reader.ReadRoomHead(ctx, uuid.New(), documentID, []uuid.UUID{ownerID}); err == nil {
		t.Fatal("ReadRoomHead for another workspace succeeded, want an error")
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET deleted_at = NOW() WHERE id = $1`, documentID); err != nil {
		t.Fatalf("trash document: %v", err)
	}
	head, err := reader.ReadRoomHead(ctx, workspaceID, documentID, []uuid.UUID{ownerID})
	if err == nil && head.Access[ownerID].CanRead {
		t.Fatalf("trashed document head = %+v, want no read access", head)
	}
}

func TestReadRoomHeadOpensMarkdownAndArchitectureRoomsOnly(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, _, reader := seedRunDocument(t, ctx, db)
	for _, tc := range []struct {
		documentType string
		read         bool
	}{{"markdown", true}, {"architecture", true}, {"mermaid", false}, {"dbdiagram", false}} {
		if _, err := db.ExecContext(ctx, `UPDATE documents SET type = $2::document_type WHERE id = $1`, documentID, tc.documentType); err != nil {
			t.Fatalf("set type %s: %v", tc.documentType, err)
		}
		head, err := reader.ReadRoomHead(ctx, workspaceID, documentID, []uuid.UUID{ownerID})
		if err != nil {
			t.Fatalf("%s: ReadRoomHead(): %v", tc.documentType, err)
		}
		if head.Access[ownerID].CanRead != tc.read {
			t.Fatalf("%s: owner can read = %v, want %v", tc.documentType, head.Access[ownerID].CanRead, tc.read)
		}
		if tc.read && head.DocumentType != tc.documentType {
			t.Fatalf("%s: DocumentType = %q", tc.documentType, head.DocumentType)
		}
	}
}
