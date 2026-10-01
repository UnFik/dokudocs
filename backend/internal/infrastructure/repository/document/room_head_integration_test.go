//go:build integration

package document

import (
	"context"
	"database/sql"
	"testing"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// TestReadRoomHeadAgreesWithReadBodyForEveryRole uses ReadBody, which takes the
// locking per-user path, as the oracle for the batched lock-free room read.
func TestReadRoomHeadAgreesWithReadBodyForEveryRole(t *testing.T) {
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
		documentID, rootID, paragraphID := uuid.New(), uuid.New(), uuid.New()
		body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
			{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
			{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		}}
		state, err := yjs.EncodeBodyV1(body)
		if err != nil {
			t.Fatalf("encode body: %v", err)
		}
		if err := seedCollaborativeDocument(ctx, db, workspaceID, documentID, owner, body, state); err != nil {
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
		if head.BodyVersion != 1 || head.BodyEpoch != 1 || head.BodySchemaVersion != 1 {
			t.Fatalf("%s: head = %+v, want version 1 epoch 1 schema 1", name, head)
		}
		for _, user := range users {
			want := collaboration.RoomAccess{}
			if snapshot, err := reader.ReadBody(ctx, collaboration.Actor{UserID: user}, workspaceID, documentID); err == nil {
				want = collaboration.RoomAccess{CanRead: true, CanEdit: snapshot.CanEdit}
			}
			if got := head.Access[user]; got != want {
				t.Fatalf("%s: user %s access = %+v, want %+v (as ReadBody reports)", name, user, got, want)
			}
		}
	}
}

func TestReadRoomHeadReportsNoAccessForATrashedOrForeignDocument(t *testing.T) {
	f := newNodeDiffFixture(t, 1)
	ctx := context.Background()
	reader := NewRepository(database.NewSQLDB(f.db))
	if _, err := reader.ReadRoomHead(ctx, uuid.New(), f.documentID, []uuid.UUID{f.authorID}); err == nil {
		t.Fatal("ReadRoomHead for another workspace succeeded, want an error")
	}
	if _, err := f.db.ExecContext(ctx, `UPDATE documents SET deleted_at = NOW() WHERE id = $1`, f.documentID); err != nil {
		t.Fatalf("trash document: %v", err)
	}
	var workspaceID uuid.UUID
	if err := f.db.QueryRowContext(ctx, `SELECT workspace_id FROM documents WHERE id = $1`, f.documentID).Scan(&workspaceID); err != nil {
		t.Fatal(err)
	}
	head, err := reader.ReadRoomHead(ctx, workspaceID, f.documentID, []uuid.UUID{f.authorID})
	if err == nil && head.Access[f.authorID].CanRead {
		t.Fatalf("trashed document head = %+v, want no read access", head)
	}
}
