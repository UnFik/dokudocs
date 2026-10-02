//go:build integration

package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/reearth/ygo/crdt"
)

func TestBodyInitializerImportsAndRetriesWithoutChangingBodyVersion(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	userID := insertAccessTestUser(t, ctx, db)
	viewerID := insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, viewerID)
		_ = db.Close()
	})
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Body initializer test', $2, $3)
	`, workspaceID, "body-initializer-"+workspaceID.String(), userID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, workspaceID, userID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}
	const source = "# Imported source"
	if _, err := db.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility)
		VALUES ($1, $2, 'Body initializer target', 'markdown', $3, $4, 'private')
	`, documentID, workspaceID, source, userID); err != nil {
		t.Fatalf("create legacy markdown document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')
	`, documentID, userID); err != nil {
		t.Fatalf("add document owner grant: %v", err)
	}

	rootID, paragraphID := uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: 1, Type: "paragraph", Content: "Imported text", Attributes: []byte(`{}`), Version: 1},
	}}
	input := collaboration.BodyInitialization{
		WorkspaceID: workspaceID, DocumentID: documentID, BaseBodyVersion: 1, BodySchemaVersion: yjs.BodySchemaVersionV1,
		SourceFingerprint: sha256.Sum256([]byte(source)), Body: body,
	}
	initializer := NewRepository(database.NewSQLDB(db))
	actor := collaboration.Actor{UserID: userID}
	if err := initializer.InitializeBody(ctx, actor, input); err != nil {
		t.Fatalf("InitializeBody(): %v", err)
	}
	if err := initializer.InitializeBody(ctx, actor, input); err != nil {
		t.Fatalf("retry InitializeBody(): %v", err)
	}
	var rootText sql.NullString
	var bodyVersion int64
	if err := db.QueryRowContext(ctx, `SELECT root_node_id::text, body_version FROM documents WHERE id = $1`, documentID).Scan(&rootText, &bodyVersion); err != nil {
		t.Fatalf("read initialized document: %v", err)
	}
	if !rootText.Valid || rootText.String != rootID.String() || bodyVersion != 1 {
		t.Fatalf("initialized root/version = (%v, %d), want (%s, 1)", rootText, bodyVersion, rootID)
	}
	state, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read initialized state: %v", err)
	}
	projected, err := yjs.ProjectV1(state, documentID)
	if err != nil || !documentbody.SameContent(body, projected) {
		t.Fatalf("initialized state projection = (%v, %v), want original body", projected, err)
	}
	reader := NewRepository(database.NewSQLDB(db))
	snapshot, err := reader.ReadBody(ctx, actor, workspaceID, documentID)
	if err != nil {
		t.Fatalf("ReadBody(): %v", err)
	}
	if snapshot.BodyVersion != 1 || snapshot.BodyEpoch != 1 || snapshot.BodySchemaVersion != yjs.BodySchemaVersionV1 || !snapshot.CanEdit ||
		!documentbody.SameContent(body, snapshot.Body) || !bytes.Equal(state, snapshot.EncodedState) {
		t.Fatalf("ReadBody() snapshot = %+v, want initialized AST/Yjs state at version 1", snapshot)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')
	`, workspaceID, viewerID); err != nil {
		t.Fatalf("add workspace viewer: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')
	`, documentID, viewerID); err != nil {
		t.Fatalf("grant document view: %v", err)
	}
	viewerSnapshot, err := reader.ReadBody(ctx, collaboration.Actor{UserID: viewerID}, workspaceID, documentID)
	if err != nil || viewerSnapshot.CanEdit {
		t.Fatalf("ReadBody() view grant = (canEdit %t, %v), want readable and read-only", viewerSnapshot.CanEdit, err)
	}
	duplicateRepo := NewRepository(database.NewSQLDB(db))
	duplicateRequestID := uuid.New()
	duplicate, err := duplicateRepo.DuplicateAuthorized(ctx, documentID, workspaceID, userID, duplicateRequestID)
	if err != nil {
		t.Fatalf("DuplicateAuthorized(): %v", err)
	}
	replayedDuplicate, err := duplicateRepo.DuplicateAuthorized(ctx, documentID, workspaceID, userID, duplicateRequestID)
	if err != nil || replayedDuplicate.ID != duplicate.ID {
		t.Fatalf("DuplicateAuthorized() retry = (%s, %v), want same ID %s", replayedDuplicate.ID, err, duplicate.ID)
	}
	duplicateSnapshot, err := reader.ReadBody(ctx, actor, workspaceID, duplicate.ID)
	if err != nil {
		t.Fatalf("read duplicate body: %v", err)
	}
	if duplicateSnapshot.BodyVersion != 1 || duplicateSnapshot.BodyEpoch != 1 || len(duplicateSnapshot.Body.Nodes) != len(snapshot.Body.Nodes) {
		t.Fatalf("duplicate body version/epoch/node count = %d/%d/%d", duplicateSnapshot.BodyVersion, duplicateSnapshot.BodyEpoch, len(duplicateSnapshot.Body.Nodes))
	}
	oldNodeIDs := make(map[uuid.UUID]struct{}, len(snapshot.Body.Nodes))
	for _, node := range snapshot.Body.Nodes {
		oldNodeIDs[node.NodeID] = struct{}{}
	}
	newNodeIDs := make(map[uuid.UUID]struct{}, len(duplicateSnapshot.Body.Nodes))
	for _, node := range duplicateSnapshot.Body.Nodes {
		if node.DocumentID != duplicate.ID || node.Version != 1 {
			t.Fatalf("duplicate node metadata = %+v", node)
		}
		if _, exists := oldNodeIDs[node.NodeID]; exists {
			t.Fatalf("duplicate reused source node ID %s", node.NodeID)
		}
		newNodeIDs[node.NodeID] = struct{}{}
	}
	for _, node := range duplicateSnapshot.Body.Nodes {
		if node.ParentID != nil {
			if _, exists := newNodeIDs[*node.ParentID]; !exists {
				t.Fatalf("duplicate node %s points to non-duplicate parent %s", node.NodeID, *node.ParentID)
			}
		}
	}
	legacyWriter := NewRepository(database.NewSQLDB(db))
	if err := legacyWriter.UpdateAuthorized(ctx, model.Document{
		ID: documentID, WorkspaceID: workspaceID, Type: "markdown", Title: "Legacy overwrite",
		Content: "# Stale Markdown", Visibility: "private",
	}, nil, userID); !errors.Is(err, constant.ErrDocumentConflict) {
		t.Fatalf("legacy body overwrite error = %v, want %v", err, constant.ErrDocumentConflict)
	}
	if err := legacyWriter.UpdateAuthorized(ctx, model.Document{
		ID: documentID, WorkspaceID: workspaceID, Type: "markdown", Title: "Metadata update",
		Content: "", Visibility: "private",
	}, nil, userID); err != nil {
		t.Fatalf("metadata-only update with AST-masked content: %v", err)
	}
	var title, storedContent string
	var storedBodyVersion int64
	if err := db.QueryRowContext(ctx, `
		SELECT title, content, body_version FROM documents WHERE id = $1
	`, documentID).Scan(&title, &storedContent, &storedBodyVersion); err != nil {
		t.Fatalf("read document after legacy update attempts: %v", err)
	}
	if title != "Metadata update" || storedContent != source || storedBodyVersion != 1 {
		t.Fatalf("legacy row = (%q, %q, version %d), want metadata-only update and body version 1", title, storedContent, storedBodyVersion)
	}
	uninitializedID := uuid.New()
	const uninitializedSource = "# Legacy Markdown"
	if _, err := db.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility)
		VALUES ($1, $2, 'Uninitialized Markdown', 'markdown', $3, $4, 'private')
	`, uninitializedID, workspaceID, uninitializedSource, userID); err != nil {
		t.Fatalf("create uninitialized Markdown document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')
	`, uninitializedID, userID); err != nil {
		t.Fatalf("add uninitialized document owner grant: %v", err)
	}
	if err := legacyWriter.UpdateAuthorized(ctx, model.Document{
		ID: uninitializedID, WorkspaceID: workspaceID, Type: "markdown", Title: "Attempted legacy edit",
		Content: "# Overwritten Markdown", Visibility: "private",
	}, nil, userID); !errors.Is(err, constant.ErrDocumentConflict) {
		t.Fatalf("uninitialized Markdown body overwrite error = %v, want %v", err, constant.ErrDocumentConflict)
	}
	if err := legacyWriter.UpdateAuthorized(ctx, model.Document{
		ID: uninitializedID, WorkspaceID: workspaceID, Type: "markdown", Title: "Legacy metadata update",
		Content: uninitializedSource, Visibility: "private",
	}, nil, userID); err != nil {
		t.Fatalf("metadata update on uninitialized Markdown: %v", err)
	}
	var uninitializedContent string
	var uninitializedRoot sql.NullString
	if err := db.QueryRowContext(ctx, `
		SELECT content, root_node_id::text FROM documents WHERE id = $1 AND title = 'Legacy metadata update'
	`, uninitializedID).Scan(&uninitializedContent, &uninitializedRoot); err != nil {
		t.Fatalf("read uninitialized document after legacy edit: %v", err)
	}
	if uninitializedContent != uninitializedSource || uninitializedRoot.Valid {
		t.Fatalf("uninitialized row = (%q, %v), want unchanged source and no AST root", uninitializedContent, uninitializedRoot)
	}
	if _, err := reader.ReadBody(ctx, collaboration.Actor{UserID: uuid.New()}, workspaceID, documentID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("ReadBody() without workspace membership error = %v, want forbidden", err)
	}

	staleDocumentID, staleRootID, staleParagraphID := uuid.New(), uuid.New(), uuid.New()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, content, author_id, visibility)
		VALUES ($1, $2, 'Stale body target', 'markdown', $3, $4, 'private')
	`, staleDocumentID, workspaceID, source, userID); err != nil {
		t.Fatalf("create stale markdown document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')
	`, staleDocumentID, userID); err != nil {
		t.Fatalf("add stale document owner grant: %v", err)
	}
	staleInput := input
	staleInput.DocumentID = staleDocumentID
	staleInput.SourceFingerprint = sha256.Sum256([]byte("different source"))
	staleInput.Body = documentbody.Body{DocumentID: staleDocumentID, RootNodeID: staleRootID, Nodes: []documentbody.Node{
		{DocumentID: staleDocumentID, NodeID: staleRootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: staleDocumentID, NodeID: staleParagraphID, ParentID: &staleRootID, SiblingOrder: 1, Type: "paragraph", Content: "Different text", Attributes: []byte(`{}`), Version: 1},
	}}
	if err := initializer.InitializeBody(ctx, actor, staleInput); !errors.Is(err, constant.ErrDocumentConflict) {
		t.Fatalf("stale InitializeBody() error = %v, want %v", err, constant.ErrDocumentConflict)
	}
	var staleRoot sql.NullString
	var staleNodes, staleStates int
	if err := db.QueryRowContext(ctx, `
		SELECT root_node_id::text,
		       (SELECT COUNT(*) FROM document_nodes WHERE document_id = $1),
		       (SELECT COUNT(*) FROM document_collab_states WHERE document_id = $1)
		FROM documents WHERE id = $1
	`, staleDocumentID).Scan(&staleRoot, &staleNodes, &staleStates); err != nil {
		t.Fatalf("read stale document: %v", err)
	}
	if staleRoot.Valid || staleNodes != 0 || staleStates != 0 {
		t.Fatalf("stale import left partial body: root=%v nodes=%d states=%d", staleRoot, staleNodes, staleStates)
	}
}

func TestCollaborativeWriterCommitsBodyAndYjsAtomically(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	authorID := insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, authorID)
		_ = db.Close()
	})
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Collaborative writer test', $2, $3)
	`, workspaceID, "collab-writer-"+workspaceID.String(), authorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, workspaceID, authorID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}

	fixture, err := os.ReadFile("../../collaboration/yjs/testdata/full_body_v1.b64")
	if err != nil {
		t.Fatalf("read frontend Yjs fixture: %v", err)
	}
	encodedState, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(fixture)))
	if err != nil {
		t.Fatalf("decode frontend Yjs fixture: %v", err)
	}
	body, err := yjs.ProjectV1(encodedState, documentID)
	if err != nil {
		t.Fatalf("project frontend Yjs fixture: %v", err)
	}
	if err := seedCollaborativeDocument(ctx, db, workspaceID, documentID, authorID, body, encodedState); err != nil {
		t.Fatalf("seed collaborative document: %v", err)
	}
	threadID := uuid.New()
	anchorNodeID := body.Nodes[2].NodeID
	if _, err := db.ExecContext(ctx, `
		INSERT INTO comment_threads (id, document_id, author_id, selected_text, content, anchor_node_id, anchor_start, anchor_end, anchor_state)
		VALUES ($1, $2, $3, 'bold', 'keep this anchor', $4, $5, $6, 'active')
	`, threadID, documentID, authorID, anchorNodeID, []byte{1}, []byte{2}); err != nil {
		t.Fatalf("create comment anchor: %v", err)
	}

	client := crdt.New()
	defer client.Destroy()
	if err := crdt.ApplyUpdateV1(client, encodedState, nil); err != nil {
		t.Fatalf("load client state: %v", err)
	}
	vector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(client))
	if err != nil {
		t.Fatalf("decode client state vector: %v", err)
	}
	root := client.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	legacyParagraph := root.Children()[1].(*crdt.YXmlElement)
	legacyText := legacyParagraph.Children()[0].(*crdt.YXmlText)
	legacyTextLength := legacyText.Len()
	if err := client.TransactE(func(tx *crdt.Transaction) error {
		legacyText.Insert(tx, legacyTextLength, "!", nil)
		return nil
	}); err != nil {
		t.Fatalf("edit client Yjs state: %v", err)
	}
	updateBytes := crdt.EncodeStateAsUpdateV1(client, vector)
	updateID := uuid.New()
	writer := NewRepository(database.NewSQLDB(db))
	update := collaboration.Update{DocumentID: documentID, UpdateID: updateID, BodyEpoch: 1, BodySchemaVersion: 1, Bytes: updateBytes}
	receipt, err := writer.CommitUpdate(ctx, collaboration.Actor{UserID: authorID}, update)
	if err != nil {
		t.Fatalf("CommitUpdate(): %v", err)
	}
	if !receipt.Changed || receipt.BodyVersion != 2 {
		t.Fatalf("receipt = %+v, want changed at version 2", receipt)
	}
	var bodyVersion int64
	if err := db.QueryRowContext(ctx, `SELECT body_version FROM documents WHERE id = $1`, documentID).Scan(&bodyVersion); err != nil {
		t.Fatalf("read body version: %v", err)
	}
	if bodyVersion != 2 {
		t.Fatalf("body_version = %d, want 2", bodyVersion)
	}
	var paragraphContent string
	if err := db.QueryRowContext(ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, body.Nodes[8].NodeID).Scan(&paragraphContent); err != nil {
		t.Fatalf("read updated AST node: %v", err)
	}
	if paragraphContent != "legacy parent text!" {
		t.Fatalf("paragraph content = %q", paragraphContent)
	}
	var restoredAnchor sql.NullString
	var anchorState string
	if err := db.QueryRowContext(ctx, `SELECT anchor_node_id::text, anchor_state FROM comment_threads WHERE id = $1`, threadID).Scan(&restoredAnchor, &anchorState); err != nil {
		t.Fatalf("read comment anchor: %v", err)
	}
	if !restoredAnchor.Valid || restoredAnchor.String != anchorNodeID.String() || anchorState != "active" {
		t.Fatalf("comment anchor = (%v, %q), want %s active", restoredAnchor, anchorState, anchorNodeID)
	}

	retry, err := writer.CommitUpdate(ctx, collaboration.Actor{UserID: authorID}, update)
	if err != nil {
		t.Fatalf("retry CommitUpdate(): %v", err)
	}
	if retry.Changed || retry.BodyVersion != 2 {
		t.Fatalf("retry receipt = %+v, want unchanged version 2", retry)
	}

	beforeRejectedState, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read state before rejection: %v", err)
	}
	vector, err = crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(client))
	if err != nil {
		t.Fatalf("decode client state vector before opaque edit: %v", err)
	}
	opaque := root.Children()[len(root.Children())-1].(*crdt.YXmlElement)
	if err := client.TransactE(func(tx *crdt.Transaction) error {
		opaque.SetAttributeValue(tx, "bodyContent", "changed source")
		return nil
	}); err != nil {
		t.Fatalf("edit opaque source: %v", err)
	}
	badUpdate := collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1,
		Bytes: crdt.EncodeStateAsUpdateV1(client, vector),
	}
	if _, err := writer.CommitUpdate(ctx, collaboration.Actor{UserID: authorID}, badUpdate); !errors.Is(err, documentbody.ErrInvalid) {
		t.Fatalf("opaque update error = %v, want %v", err, documentbody.ErrInvalid)
	}
	afterRejectedState, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read state after rejection: %v", err)
	}
	if string(afterRejectedState) != string(beforeRejectedState) {
		t.Fatal("rejected update changed durable Yjs state")
	}
	if err := db.QueryRowContext(ctx, `SELECT body_version FROM documents WHERE id = $1`, documentID).Scan(&bodyVersion); err != nil {
		t.Fatalf("read body version after rejection: %v", err)
	}
	if bodyVersion != 2 {
		t.Fatalf("body_version after rejection = %d, want 2", bodyVersion)
	}

	deleteClient := crdt.New()
	defer deleteClient.Destroy()
	if err := crdt.ApplyUpdateV1(deleteClient, beforeRejectedState, nil); err != nil {
		t.Fatalf("load client state before structural delete: %v", err)
	}
	deleteVector, err := crdt.DecodeStateVectorV1(crdt.EncodeStateVectorV1(deleteClient))
	if err != nil {
		t.Fatalf("decode client state vector before structural delete: %v", err)
	}
	deleteRoot := deleteClient.GetXmlFragment("body").Children()[0].(*crdt.YXmlElement)
	if err := deleteClient.TransactE(func(tx *crdt.Transaction) error {
		deleteRoot.Delete(tx, 1, 1)
		return nil
	}); err != nil {
		t.Fatalf("delete existing block in Yjs client: %v", err)
	}
	deleteUpdate := collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1,
		Bytes: crdt.EncodeStateAsUpdateV1(deleteClient, deleteVector),
	}
	if _, err := writer.CommitUpdate(ctx, collaboration.Actor{UserID: authorID}, deleteUpdate); !errors.Is(err, documentbody.ErrInvalid) {
		t.Fatalf("existing block delete update error = %v, want %v", err, documentbody.ErrInvalid)
	}
	afterDeleteState, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read state after rejected structural delete: %v", err)
	}
	if !bytes.Equal(afterDeleteState, beforeRejectedState) {
		t.Fatal("rejected structural delete changed durable Yjs state")
	}
	if err := db.QueryRowContext(ctx, `SELECT body_version FROM documents WHERE id = $1`, documentID).Scan(&bodyVersion); err != nil {
		t.Fatalf("read body version after rejected structural delete: %v", err)
	}
	if bodyVersion != 2 {
		t.Fatalf("body_version after rejected structural delete = %d, want 2", bodyVersion)
	}
}

func TestMoveNodeCommitsReceiptAndFencesOldEpoch(t *testing.T) {
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
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'MoveNode test', $2, $3)
	`, workspaceID, "move-node-"+workspaceID.String(), userID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, workspaceID, userID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}

	rootID, firstID, secondID := uuid.New(), uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: firstID, ParentID: &rootID, SiblingOrder: 1, Type: "paragraph", Content: "first", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: secondID, ParentID: &rootID, SiblingOrder: 2, Type: "paragraph", Content: "second", Attributes: []byte(`{}`), Version: 1},
	}}
	state, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode initial body: %v", err)
	}
	if err := seedCollaborativeDocument(ctx, db, workspaceID, documentID, userID, body, state); err != nil {
		t.Fatalf("seed collaborative document: %v", err)
	}
	writer := NewRepository(database.NewSQLDB(db))
	actor := collaboration.Actor{UserID: userID}
	command := collaboration.MoveNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: uuid.New(),
		BodyEpoch: 1, BodySchemaVersion: yjs.BodySchemaVersionV1,
		NodeID: firstID, TargetParentID: rootID,
	}
	first, err := writer.MoveNode(ctx, actor, command)
	if err != nil {
		t.Fatalf("MoveNode(): %v", err)
	}
	if !first.Changed || first.BodyVersion != 2 || first.BodyEpoch != 2 {
		t.Fatalf("MoveNode receipt = %+v, want changed at version/epoch 2", first)
	}

	retry, err := writer.MoveNode(ctx, actor, command)
	if err != nil || !reflect.DeepEqual(retry, first) {
		t.Fatalf("retry MoveNode() = (%+v, %v), want original receipt %+v", retry, err, first)
	}
	reusedID := command
	reusedID.TargetParentID = secondID
	if _, err := writer.MoveNode(ctx, actor, reusedID); !errors.Is(err, collaboration.ErrMoveCommandReplay) {
		t.Fatalf("reused command ID error = %v, want %v", err, collaboration.ErrMoveCommandReplay)
	}

	snapshot, err := NewRepository(database.NewSQLDB(db)).ReadBody(ctx, actor, workspaceID, documentID)
	if err != nil {
		t.Fatalf("read moved body: %v", err)
	}
	movedNodes := make(map[uuid.UUID]documentbody.Node, len(snapshot.Body.Nodes))
	for _, node := range snapshot.Body.Nodes {
		movedNodes[node.NodeID] = node
	}
	firstNode, hasFirst := movedNodes[firstID]
	secondNode, hasSecond := movedNodes[secondID]
	if snapshot.BodyEpoch != 2 || snapshot.BodyVersion != 2 || !hasFirst || !hasSecond ||
		firstNode.ParentID == nil || *firstNode.ParentID != rootID ||
		secondNode.ParentID == nil || *secondNode.ParentID != rootID ||
		secondNode.SiblingOrder >= firstNode.SiblingOrder {
		t.Fatalf("moved sibling orders = second:%v first:%v at epoch/version %d/%d, want second before first", secondNode.SiblingOrder, firstNode.SiblingOrder, snapshot.BodyEpoch, snapshot.BodyVersion)
	}
	projected, err := yjs.ProjectV1(snapshot.EncodedState, documentID)
	if err != nil || !documentbody.SameContent(snapshot.Body, projected) {
		t.Fatalf("moved Yjs projection = (%v, %v), want committed AST", projected, err)
	}
	if _, err := writer.CommitUpdate(ctx, actor, collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1,
		BodySchemaVersion: yjs.BodySchemaVersionV1, Bytes: state,
	}); !errors.Is(err, collaboration.ErrStaleBodyEpoch) {
		t.Fatalf("old-epoch update error = %v, want %v", err, collaboration.ErrStaleBodyEpoch)
	}

	noOp := collaboration.MoveNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: uuid.New(),
		BodyEpoch: 2, BodySchemaVersion: yjs.BodySchemaVersionV1,
		NodeID: secondID, TargetParentID: rootID, BeforeNodeID: &firstID,
	}
	noOpReceipt, err := writer.MoveNode(ctx, actor, noOp)
	if err != nil || noOpReceipt.Changed || noOpReceipt.BodyVersion != 2 || noOpReceipt.BodyEpoch != 2 {
		t.Fatalf("no-op MoveNode() = (%+v, %v), want receipt without advancing body", noOpReceipt, err)
	}
}

func TestDeleteNodeCommitsReceiptAndFencesOldEpoch(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatal(err)
	}
	userID := insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_ = db.Close()
	})
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'DeleteNode test', $2, $3)
	`, workspaceID, "delete-node-"+workspaceID.String(), userID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, workspaceID, userID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}

	rootID, deletedID, childID, siblingID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: deletedID, ParentID: &rootID, SiblingOrder: 1, Type: "block-quote", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: childID, ParentID: &deletedID, SiblingOrder: 1, Type: "paragraph", Content: "deleted child", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: siblingID, ParentID: &rootID, SiblingOrder: 2, Type: "paragraph", Content: "survives", Attributes: []byte(`{}`), Version: 1},
	}}
	state, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode initial body: %v", err)
	}
	if err := seedCollaborativeDocument(ctx, db, workspaceID, documentID, userID, body, state); err != nil {
		t.Fatalf("seed collaborative document: %v", err)
	}
	deletedThreadID, survivingThreadID := uuid.New(), uuid.New()
	if _, err := db.ExecContext(ctx, `
		INSERT INTO comment_threads (id, document_id, author_id, selected_text, content, anchor_node_id, anchor_state)
		VALUES ($1, $3, $4, 'deleted text', 'thread on deleted block', $2, 'active'),
		       ($5, $3, $4, 'surviving text', 'thread on surviving block', $6, 'active')
	`, deletedThreadID, childID, documentID, userID, survivingThreadID, siblingID); err != nil {
		t.Fatalf("create comment anchors: %v", err)
	}
	writer := NewRepository(database.NewSQLDB(db))
	actor := collaboration.Actor{UserID: userID}
	command := collaboration.DeleteNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: uuid.New(),
		BodyEpoch: 1, BodySchemaVersion: yjs.BodySchemaVersionV1, NodeIDs: []uuid.UUID{deletedID},
	}
	first, err := writer.DeleteNode(ctx, actor, command)
	if err != nil {
		t.Fatalf("DeleteNode(): %v", err)
	}
	if !first.Changed || first.BodyVersion != 2 || first.BodyEpoch != 2 {
		t.Fatalf("DeleteNode receipt = %+v, want changed at version/epoch 2", first)
	}
	if retry, err := writer.DeleteNode(ctx, actor, command); err != nil || !reflect.DeepEqual(retry, first) {
		t.Fatalf("retry DeleteNode() = (%+v, %v), want original receipt %+v", retry, err, first)
	}
	reusedID := command
	reusedID.NodeIDs = []uuid.UUID{siblingID}
	if _, err := writer.DeleteNode(ctx, actor, reusedID); !errors.Is(err, collaboration.ErrDeleteCommandReplay) {
		t.Fatalf("reused command ID error = %v, want %v", err, collaboration.ErrDeleteCommandReplay)
	}
	if _, err := writer.MoveNode(ctx, actor, collaboration.MoveNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: command.CommandID,
		BodyEpoch: command.BodyEpoch, BodySchemaVersion: command.BodySchemaVersion,
		NodeID: deletedID, TargetParentID: rootID,
	}); !errors.Is(err, collaboration.ErrMoveCommandReplay) {
		t.Fatalf("cross-command reused ID error = %v, want %v", err, collaboration.ErrMoveCommandReplay)
	}

	snapshot, err := writer.ReadBody(ctx, actor, workspaceID, documentID)
	if err != nil {
		t.Fatalf("read deleted body: %v", err)
	}
	// loadDocumentBody has no ORDER BY, so rows come back in heap order; look the
	// survivor up by ID instead of by position.
	survivor := false
	for _, node := range snapshot.Body.Nodes {
		survivor = survivor || node.NodeID == siblingID
	}
	if snapshot.BodyEpoch != 2 || snapshot.BodyVersion != 2 || len(snapshot.Body.Nodes) != 2 || !survivor {
		t.Fatalf("deleted body = %+v at epoch/version %d/%d, want root and surviving sibling", snapshot.Body.Nodes, snapshot.BodyEpoch, snapshot.BodyVersion)
	}
	var deletedAnchor sql.NullString
	var deletedAnchorState string
	if err := db.QueryRowContext(ctx, `
		SELECT anchor_node_id::text, anchor_state FROM comment_threads WHERE id = $1
	`, deletedThreadID).Scan(&deletedAnchor, &deletedAnchorState); err != nil {
		t.Fatalf("read deleted node comment anchor: %v", err)
	}
	if deletedAnchor.Valid || deletedAnchorState != "orphan" {
		t.Fatalf("deleted node comment anchor = (%v, %q), want (null, orphan)", deletedAnchor, deletedAnchorState)
	}
	var survivingAnchor sql.NullString
	var survivingAnchorState string
	if err := db.QueryRowContext(ctx, `
		SELECT anchor_node_id::text, anchor_state FROM comment_threads WHERE id = $1
	`, survivingThreadID).Scan(&survivingAnchor, &survivingAnchorState); err != nil {
		t.Fatalf("read surviving node comment anchor: %v", err)
	}
	if !survivingAnchor.Valid || survivingAnchor.String != siblingID.String() || survivingAnchorState != "active" {
		t.Fatalf("surviving node comment anchor = (%v, %q), want (%s, active)", survivingAnchor, survivingAnchorState, siblingID)
	}
	projected, err := yjs.ProjectV1(snapshot.EncodedState, documentID)
	if err != nil || !documentbody.SameContent(snapshot.Body, projected) {
		t.Fatalf("deleted Yjs projection = (%v, %v), want committed AST", projected, err)
	}
	if _, err := writer.CommitUpdate(ctx, actor, collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1,
		BodySchemaVersion: yjs.BodySchemaVersionV1, Bytes: state,
	}); !errors.Is(err, collaboration.ErrStaleBodyEpoch) {
		t.Fatalf("old-epoch update error = %v, want %v", err, collaboration.ErrStaleBodyEpoch)
	}
}

func seedCollaborativeDocument(ctx context.Context, db *sql.DB, workspaceID, documentID, authorID uuid.UUID, body documentbody.Body, state []byte) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO documents (id, workspace_id, title, type, author_id, visibility)
		VALUES ($1, $2, 'Collaborative writer target', 'markdown', $3, 'private')
	`, documentID, workspaceID, authorID); err != nil {
		return err
	}
	for _, node := range body.Nodes {
		var parentID any
		if node.ParentID != nil {
			parentID = *node.ParentID
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version)
			VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
		`, documentID, node.NodeID, parentID, node.SiblingOrder, node.Type, node.Content, string(node.Attributes), node.Version); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE documents SET root_node_id = $2 WHERE id = $1`, documentID, body.RootNodeID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO document_collab_states (document_id, encoded_state, schema_version) VALUES ($1, $2, 1)
	`, documentID, state); err != nil {
		return err
	}
	return tx.Commit()
}

func readCollaborationState(ctx context.Context, db *sql.DB, documentID uuid.UUID) ([]byte, error) {
	var state []byte
	err := db.QueryRowContext(ctx, `SELECT encoded_state FROM document_collab_states WHERE document_id = $1`, documentID).Scan(&state)
	return state, err
}
