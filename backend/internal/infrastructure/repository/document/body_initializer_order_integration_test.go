//go:build integration

package document

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"testing"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// The Yjs projection numbers siblings from 0, so rows stored from a body that
// numbers them from 1 differ from it and the first commit rewrites every row.
func TestInitializeBodyStoresSiblingOrderTheWayTheYjsProjectionNumbersIt(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	userID := insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_ = db.Close()
	})
	const source = "one\n\ntwo\n\nthree"
	for _, stmt := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Init order', $2, $3)`, []any{workspaceID, "init-order-" + workspaceID.String(), userID}},
		{`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, []any{workspaceID, userID}},
		{`INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility) VALUES ($1, $2, 'Init order', 'markdown', $3, $4, 'private')`, []any{documentID, workspaceID, source, userID}},
		{`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, []any{documentID, userID}},
	} {
		if _, err := db.ExecContext(ctx, stmt.query, stmt.args...); err != nil {
			t.Fatalf("seed %q: %v", stmt.query, err)
		}
	}

	rootID := uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
	}}
	for i, text := range []string{"one", "two", "three"} {
		paragraphID, runID := uuid.New(), uuid.New()
		body.Nodes = append(body.Nodes,
			documentbody.Node{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: float64(i + 1), Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
			documentbody.Node{DocumentID: documentID, NodeID: runID, ParentID: &paragraphID, SiblingOrder: 1, Type: "run", Content: text, Attributes: []byte(`{}`), Version: 1},
		)
	}
	repo := NewRepository(database.NewSQLDB(db))
	if err := repo.InitializeBody(ctx, collaboration.Actor{UserID: userID}, collaboration.BodyInitialization{
		WorkspaceID: workspaceID, DocumentID: documentID, BaseBodyVersion: 1, BodySchemaVersion: yjs.BodySchemaVersionV1,
		SourceFingerprint: sha256.Sum256([]byte(source)), Body: body,
	}); err != nil {
		t.Fatalf("InitializeBody(): %v", err)
	}

	state, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	projected, err := yjs.ProjectV1(state, documentID)
	if err != nil {
		t.Fatalf("project state: %v", err)
	}
	stored, err := loadDocumentBody(ctx, db, documentID, rootID)
	if err != nil {
		t.Fatalf("load stored body: %v", err)
	}
	projectedOrder := map[uuid.UUID]float64{}
	for _, node := range projected.Nodes {
		projectedOrder[node.NodeID] = node.SiblingOrder
	}
	if len(stored.Nodes) != len(projected.Nodes) {
		t.Fatalf("stored %d nodes, projection has %d", len(stored.Nodes), len(projected.Nodes))
	}
	for _, node := range stored.Nodes {
		if node.SiblingOrder != projectedOrder[node.NodeID] {
			t.Errorf("%s %s stored sibling_order %v, projection numbers it %v", node.Type, node.NodeID, node.SiblingOrder, projectedOrder[node.NodeID])
		}
	}
}
