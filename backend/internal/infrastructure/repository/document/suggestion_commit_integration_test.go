//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"testing"

	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// A suggestion reaches the server as an ordinary Yjs update. It must be stored
// and shared, and it must leave the canonical body, document_nodes, and the body
// version alone. An editor accepting it is the update that changes them.

func suggestionUpdate(t *testing.T, persisted []byte, edit func(tx *crdt.Transaction, text *crdt.YXmlText)) []byte {
	t.Helper()
	client := crdt.New()
	defer client.Destroy()
	if err := crdt.ApplyUpdateV1(client, persisted, nil); err != nil {
		t.Fatalf("load client state: %v", err)
	}
	vector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(client))
	if err != nil {
		t.Fatalf("decode state vector: %v", err)
	}
	root := client.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	text := root.Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
	if err := client.TransactE(func(tx *crdt.Transaction) error {
		edit(tx, text)
		return nil
	}); err != nil {
		t.Fatalf("edit client state: %v", err)
	}
	return crdt.EncodeStateAsUpdateV1(client, vector)
}

func TestSuggestionUpdateIsSharedButDoesNotChangeTheCanonicalBody(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	suggestionID := uuid.New()
	mark := func(kind string) crdt.Attributes {
		return crdt.Attributes{"suggestion_" + kind: crdt.Attributes{"id": suggestionID.String(), "author": ownerID.String()}}
	}
	persisted, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}

	// A Replace: "plain" is proposed for deletion and " text" is proposed in its place.
	update := suggestionUpdate(t, persisted, func(tx *crdt.Transaction, text *crdt.YXmlText) {
		text.Format(tx, 0, 5, mark("delete"))
		text.Insert(tx, 5, " text", mark("insert"))
	})
	receipt, err := repo.CommitUpdate(ctx, collaboration.Actor{UserID: ownerID}, collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: update,
	})
	if err != nil {
		t.Fatalf("CommitUpdate() with a suggestion: %v", err)
	}
	if receipt.BodyVersion != 1 {
		t.Fatalf("receipt body version = %d, want 1: a suggestion is not a change to the canonical body", receipt.BodyVersion)
	}

	var content string
	var bodyVersion int64
	if err := db.QueryRowContext(ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, runID).Scan(&content); err != nil {
		t.Fatalf("read run: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT body_version FROM documents WHERE id = $1`, documentID).Scan(&bodyVersion); err != nil {
		t.Fatalf("read body version: %v", err)
	}
	if content != "plain" || bodyVersion != 1 {
		t.Fatalf("run = %q at body version %d, want \"plain\" at 1", content, bodyVersion)
	}
	var nodes int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM document_nodes WHERE document_id = $1`, documentID).Scan(&nodes); err != nil || nodes != 3 {
		t.Fatalf("document_nodes holds %d rows (%v), want document, paragraph, run", nodes, err)
	}

	// The suggestion is in the shared state, so other clients receive it.
	stored, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read stored state: %v", err)
	}
	suggestions, err := yjs.SuggestionsV1(stored)
	if err != nil || len(suggestions) != 1 || suggestions[0].ID != suggestionID || suggestions[0].Author != ownerID {
		t.Fatalf("stored suggestions = (%+v, %v), want the one just made by %s", suggestions, err, ownerID)
	}

	// Readers: someone who can read the document gets the shared state with the
	// suggestion in it; a public link gets the canonical body only.
	snapshot, err := repo.ReadBody(ctx, collaboration.Actor{UserID: ownerID}, workspaceID, documentID)
	if err != nil {
		t.Fatalf("ReadBody() with a pending suggestion: %v", err)
	}
	if infos, err := yjs.SuggestionsV1(snapshot.EncodedState); err != nil || len(infos) != 1 {
		t.Fatalf("suggestions in the state a reader receives = (%+v, %v), want the pending one", infos, err)
	}
	for _, node := range snapshot.Body.Nodes {
		if node.NodeID == runID && node.Content != "plain" {
			t.Fatalf("ReadBody() run = %q, want the canonical \"plain\"", node.Content)
		}
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET share_token = $2, visibility = 'public_link', is_draft = FALSE WHERE id = $1`, documentID, "suggestion-public-"+documentID.String()); err != nil {
		t.Fatalf("share the document: %v", err)
	}
	public, err := repo.ReadPublicBody(ctx, "suggestion-public-"+documentID.String())
	if err != nil {
		t.Fatalf("ReadPublicBody() with a pending suggestion: %v", err)
	}
	for _, node := range public.Body.Nodes {
		if node.NodeID == runID && node.Content != "plain" {
			t.Fatalf("public run = %q, want the canonical \"plain\"", node.Content)
		}
		if strings.Contains(string(node.Attributes), "suggestion") {
			t.Fatalf("public node %s carries a suggestion: %s", node.NodeID, node.Attributes)
		}
	}

	// An editor accepts the insertion by clearing its mark: that is what makes
	// the text canonical, and so what moves the body version and the rows.
	accept := suggestionUpdate(t, stored, func(tx *crdt.Transaction, text *crdt.YXmlText) {
		text.Format(tx, 5, 5, crdt.Attributes{"suggestion_insert": nil})
	})
	accepted, err := repo.CommitUpdate(ctx, collaboration.Actor{UserID: ownerID}, collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: accept,
	})
	if err != nil {
		t.Fatalf("CommitUpdate() accepting the insertion: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, runID).Scan(&content); err != nil {
		t.Fatalf("read run after accept: %v", err)
	}
	if accepted.BodyVersion != 2 || content != "plain text" {
		t.Fatalf("after accepting: version %d, run %q, want 2 and \"plain text\"", accepted.BodyVersion, content)
	}
}

// DeleteNode and MoveNode change the stored Yjs state in place, so a suggestion in
// a block they do not touch is still there afterwards, and the canonical text is
// still the one without it.
func TestStructuralCommandsKeepPendingSuggestions(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	userID := insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Structural guard', $2, $3)`, workspaceID, "structural-guard-"+workspaceID.String(), userID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, userID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}
	rootID, firstID, firstRunID, secondID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: firstID, ParentID: &rootID, SiblingOrder: 0, Type: "paragraph", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: firstRunID, ParentID: &firstID, SiblingOrder: 0, Type: "run", Content: "plain", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: secondID, ParentID: &rootID, SiblingOrder: 1, Type: "paragraph", Content: "other", Attributes: []byte(`{}`), Version: 1},
	}}
	state, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode body: %v", err)
	}
	if err := seedCollaborativeDocument(ctx, db, workspaceID, documentID, userID, body, state); err != nil {
		t.Fatalf("seed document: %v", err)
	}
	repo := NewRepository(database.NewSQLDB(db))
	actor := collaboration.Actor{UserID: userID}

	suggestionID := uuid.New()
	update := suggestionUpdate(t, state, func(tx *crdt.Transaction, text *crdt.YXmlText) {
		text.Insert(tx, 5, "!", crdt.Attributes{"suggestion_insert": crdt.Attributes{"id": suggestionID.String(), "author": userID.String()}})
	})
	if _, err := repo.CommitUpdate(ctx, actor, collaboration.Update{DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: update}); err != nil {
		t.Fatalf("CommitUpdate() with a suggestion: %v", err)
	}

	pendingSuggestions := func(label string) {
		t.Helper()
		stored, err := readCollaborationState(ctx, db, documentID)
		if err != nil {
			t.Fatalf("%s: read state: %v", label, err)
		}
		suggestions, err := yjs.SuggestionsV1(stored)
		if err != nil || len(suggestions) != 1 || suggestions[0].ID != suggestionID {
			t.Fatalf("%s: suggestions = (%+v, %v), want the one pending suggestion kept", label, suggestions, err)
		}
	}
	epochAndVersion := func() (epoch, version int64) {
		t.Helper()
		if err := db.QueryRowContext(ctx, `SELECT body_epoch, body_version FROM documents WHERE id = $1`, documentID).Scan(&epoch, &version); err != nil {
			t.Fatalf("read epoch and version: %v", err)
		}
		return epoch, version
	}
	_, versionBefore := epochAndVersion()

	// An unrelated block moves above the one that carries the suggestion.
	moved, err := repo.MoveNode(ctx, actor, collaboration.MoveNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1,
		NodeID: secondID, TargetParentID: rootID, BeforeNodeID: &firstID,
	})
	if err != nil || !moved.Changed || moved.BodyEpoch != 2 || moved.BodyVersion != versionBefore+1 {
		t.Fatalf("MoveNode() with a pending suggestion = (%+v, %v), want it applied at epoch 2, version %d", moved, err, versionBefore+1)
	}
	pendingSuggestions("after the move")
	snapshot, err := repo.ReadBody(ctx, actor, workspaceID, documentID)
	if err != nil {
		t.Fatalf("ReadBody() after the move: %v", err)
	}
	var order []uuid.UUID
	for _, node := range snapshot.Body.Nodes {
		if node.ParentID != nil && *node.ParentID == rootID {
			order = append(order, node.NodeID)
		}
	}
	sort.Slice(order, func(i, j int) bool {
		return siblingOrder(snapshot.Body, order[i]) < siblingOrder(snapshot.Body, order[j])
	})
	if len(order) != 2 || order[0] != secondID || order[1] != firstID {
		t.Fatalf("top-level order after the move = %v, want the moved block first", order)
	}

	// The block that was moved is deleted again; the suggestion in the other
	// block is still there, and its text is still the canonical one.
	deleted, err := repo.DeleteNode(ctx, actor, collaboration.DeleteNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: uuid.New(), BodyEpoch: 2, BodySchemaVersion: 1, NodeID: secondID,
	})
	if err != nil || !deleted.Changed || deleted.BodyEpoch != 3 {
		t.Fatalf("DeleteNode() with a pending suggestion = (%+v, %v), want it applied at epoch 3", deleted, err)
	}
	pendingSuggestions("after the delete")
	var content string
	if err := db.QueryRowContext(ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, firstRunID).Scan(&content); err != nil || content != "plain" {
		t.Fatalf("run = %q (%v), want the canonical \"plain\", not the suggested text", content, err)
	}
	if err := db.QueryRowContext(ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, secondID).Scan(&content); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted block still in document_nodes (%q, %v)", content, err)
	}
}

func siblingOrder(body documentbody.Body, id uuid.UUID) float64 {
	for _, node := range body.Nodes {
		if node.NodeID == id {
			return node.SiblingOrder
		}
	}
	return 0
}
