//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func seedRunDocument(t *testing.T, ctx context.Context, db *sql.DB) (workspaceID, documentID, ownerID, paragraphID, runID uuid.UUID, repo *Repository) {
	t.Helper()
	ownerID = insertAccessTestUser(t, ctx, db)
	workspaceID, documentID = uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, ownerID)
	})
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed %q: %v", query, err)
		}
	}
	mustExec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Format test', $2, $3)`, workspaceID, "format-"+workspaceID.String(), ownerID)
	mustExec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, ownerID)
	mustExec(`INSERT INTO documents (id, workspace_id, title, type, author_id) VALUES ($1, $2, 'Format target', 'markdown', $3)`, documentID, workspaceID, ownerID)
	mustExec(`INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, documentID, ownerID)
	rootID := uuid.New()
	paragraphID, runID = uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: runID, ParentID: &paragraphID, Type: "run", Content: "plain", Attributes: []byte(`{}`), Version: 1},
	}}
	encoded, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode body: %v", err)
	}
	mustExec(`INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version) VALUES ($1, $2, NULL, 0, 'document', '', '{}', 1), ($1, $3, $2, 0, 'paragraph', '', '{}', 1), ($1, $4, $3, 0, 'run', 'plain', '{}', 1)`, documentID, rootID, paragraphID, runID)
	mustExec(`UPDATE documents SET root_node_id = $2 WHERE id = $1`, documentID, rootID)
	mustExec(`INSERT INTO document_collab_states (document_id, encoded_state, schema_version) VALUES ($1, $2, 1)`, documentID, encoded)
	return workspaceID, documentID, ownerID, paragraphID, runID, NewRepository(database.NewSQLDB(db))
}

func TestAcceptFormatSuggestionSetsRunAttributesAndAdvancesEpoch(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	suggestion := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: ownerID,
		BaseBodyVersion: 1, BaseBodyEpoch: 1, OperationSchemaVersion: 1, Provenance: "human",
		Operations: []byte(`[{"op":"format","nodeID":"` + runID.String() + `","attributes":{"bold":true}}]`),
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, suggestion); err != nil {
		t.Fatalf("CreateSuggestion(): %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, suggestion.SuggestionID, ownerID); err != nil {
		t.Fatalf("AcceptSuggestion(): %v", err)
	}
	var attributes string
	var version, epoch int64
	if err := db.QueryRowContext(ctx, `SELECT attributes::text FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, runID).Scan(&attributes); err != nil {
		t.Fatalf("read run: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT body_version, body_epoch FROM documents WHERE id = $1`, documentID).Scan(&version, &epoch); err != nil {
		t.Fatalf("read version: %v", err)
	}
	if attributes != `{"bold": true}` || version != 2 || epoch != 2 {
		t.Fatalf("run attributes = %s version %d epoch %d, want bold, version 2, epoch 2", attributes, version, epoch)
	}
}

func TestConflictedSuggestionKeepsBackendReason(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	suggestion := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: ownerID,
		BaseBodyVersion: 1, BaseBodyEpoch: 1, OperationSchemaVersion: 1, Provenance: "human",
		Reason:     "Because I said so",
		Operations: []byte(`[{"op":"delete","nodeID":"` + uuid.NewString() + `"}]`),
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, suggestion); err != nil {
		t.Fatalf("CreateSuggestion(): %v", err)
	}
	_ = runID
	err = repo.AcceptSuggestion(ctx, workspaceID, documentID, suggestion.SuggestionID, ownerID)
	if !errors.Is(err, collaboration.ErrSuggestionConflict) {
		t.Fatalf("AcceptSuggestion() = %v, want conflict", err)
	}
	items, err := repo.ListSuggestions(ctx, workspaceID, documentID, ownerID)
	if err != nil || len(items) != 1 {
		t.Fatalf("ListSuggestions() = (%+v, %v)", items, err)
	}
	if items[0].Status != "conflicted" || items[0].ConflictReason != "missing-node" || items[0].Reason != "Because I said so" {
		t.Fatalf("suggestion = %+v, want conflicted, conflictReason missing-node, proposer reason kept", items[0])
	}
}
