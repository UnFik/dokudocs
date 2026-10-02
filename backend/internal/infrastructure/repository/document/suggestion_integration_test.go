//go:build integration

package document

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestSuggestionRepositoryPersistsBatchAndRejectsItOnce(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	actorID := insertAccessTestUser(t, ctx, db)
	viewerID := insertAccessTestUser(t, ctx, db)
	workspaceID, documentID := uuid.New(), uuid.New()
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, actorID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, viewerID)
	})
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Suggestion test', $2, $3)`, workspaceID, "suggestion-"+workspaceID.String(), actorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, workspaceID, actorID); err != nil {
		t.Fatalf("add workspace owner: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, viewerID); err != nil {
		t.Fatalf("add workspace viewer: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, author_id) VALUES ($1, $2, 'Suggestion target', 'markdown', $3)`, documentID, workspaceID, actorID); err != nil {
		t.Fatalf("create document: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, documentID, actorID); err != nil {
		t.Fatalf("add owner grant: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'view')`, documentID, viewerID); err != nil {
		t.Fatalf("add viewer grant: %v", err)
	}
	rootID, paragraphID := uuid.New(), uuid.New()
	body := documentbody.Body{DocumentID: documentID, RootNodeID: rootID, Nodes: []documentbody.Node{
		{DocumentID: documentID, NodeID: rootID, Type: "document", Attributes: []byte(`{}`), Version: 1},
		{DocumentID: documentID, NodeID: paragraphID, ParentID: &rootID, SiblingOrder: 0, Type: "paragraph", Content: "before", Attributes: []byte(`{}`), Version: 1},
	}}
	encoded, err := yjs.EncodeBodyV1(body)
	if err != nil {
		t.Fatalf("encode body: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version) VALUES ($1, $2, NULL, 0, 'document', '', '{}', 1), ($1, $3, $2, 0, 'paragraph', 'before', '{}', 1)`, documentID, rootID, paragraphID); err != nil {
		t.Fatalf("insert body nodes: %v", err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET root_node_id = $2 WHERE id = $1`, documentID, rootID); err != nil {
		t.Fatalf("set body root: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_collab_states (document_id, encoded_state, schema_version) VALUES ($1, $2, 1)`, documentID, encoded); err != nil {
		t.Fatalf("insert body state: %v", err)
	}
	repo := NewRepository(database.NewSQLDB(db))
	suggestion := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: actorID,
		BaseBodyVersion: 1, BaseBodyEpoch: 1, OperationSchemaVersion: 1,
		Provenance: "human", Operations: []byte(`[{"op":"insert_text"}]`), Summary: "Add text",
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, suggestion); err != nil {
		t.Fatalf("CreateSuggestion(): %v", err)
	}
	viewerSuggestions, err := repo.ListSuggestions(ctx, workspaceID, documentID, viewerID)
	if err != nil || len(viewerSuggestions) != 0 {
		t.Fatalf("ListSuggestions() for viewer = (%+v, %v), want no proposal details", viewerSuggestions, err)
	}
	items, err := repo.ListSuggestions(ctx, workspaceID, documentID, actorID)
	if err != nil || len(items) != 1 || items[0].Status != "pending" {
		t.Fatalf("ListSuggestions() = (%+v, %v), want one pending suggestion", items, err)
	}
	if err := repo.RejectSuggestion(ctx, workspaceID, documentID, suggestion.SuggestionID, actorID); err != nil {
		t.Fatalf("RejectSuggestion(): %v", err)
	}
	if err := repo.RejectSuggestion(ctx, workspaceID, documentID, suggestion.SuggestionID, actorID); err != nil {
		t.Fatalf("RejectSuggestion() idempotent retry: %v", err)
	}
	accepted := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: actorID,
		BaseBodyVersion: 1, BaseBodyEpoch: 1, OperationSchemaVersion: 1,
		Provenance: "AI", Operations: []byte(`[{"op":"replace_text","nodeID":"` + paragraphID.String() + `","content":"accepted"}]`),
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, accepted); err != nil {
		t.Fatalf("CreateSuggestion() acceptance batch: %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, accepted.SuggestionID, actorID); err != nil {
		t.Fatalf("AcceptSuggestion(): %v", err)
	}
	var content string
	var bodyVersion int64
	if err := db.QueryRowContext(ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, paragraphID).Scan(&content); err != nil {
		t.Fatalf("read accepted node: %v", err)
	}
	if content != "accepted" {
		t.Fatalf("accepted node content = %q, want accepted", content)
	}
	if err := db.QueryRowContext(ctx, `SELECT body_version FROM documents WHERE id = $1`, documentID).Scan(&bodyVersion); err != nil {
		t.Fatalf("read accepted body version: %v", err)
	}
	if bodyVersion != 2 {
		t.Fatalf("accepted body version = %d, want 2", bodyVersion)
	}
	insertedID := uuid.New()
	insertSuggestion := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: actorID,
		BaseBodyVersion: 2, BaseBodyEpoch: 1, OperationSchemaVersion: 1,
		Provenance: "human", Operations: []byte(`[{"op":"insert","nodeID":"` + insertedID.String() + `","parentID":"` + rootID.String() + `","type":"paragraph","content":"inserted","attributes":{}}]`),
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, insertSuggestion); err != nil {
		t.Fatalf("CreateSuggestion() insert: %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, insertSuggestion.SuggestionID, actorID); err != nil {
		t.Fatalf("AcceptSuggestion() insert: %v", err)
	}
	moveSuggestion := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: actorID,
		BaseBodyVersion: 3, BaseBodyEpoch: 2, OperationSchemaVersion: 1,
		Provenance: "human", Operations: []byte(`[{"op":"move","nodeID":"` + insertedID.String() + `","targetParentID":"` + rootID.String() + `","beforeNodeID":"` + paragraphID.String() + `"}]`),
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, moveSuggestion); err != nil {
		t.Fatalf("CreateSuggestion() move: %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, moveSuggestion.SuggestionID, actorID); err != nil {
		t.Fatalf("AcceptSuggestion() move: %v", err)
	}
	deleteSuggestion := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: actorID,
		BaseBodyVersion: 4, BaseBodyEpoch: 3, OperationSchemaVersion: 1,
		Provenance: "human", Operations: []byte(`[{"op":"delete","nodeID":"` + insertedID.String() + `"}]`),
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, deleteSuggestion); err != nil {
		t.Fatalf("CreateSuggestion() delete: %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, deleteSuggestion.SuggestionID, actorID); err != nil {
		t.Fatalf("AcceptSuggestion() delete: %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, moveSuggestion.SuggestionID, actorID); err != nil {
		t.Fatalf("AcceptSuggestion() move retry: %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, deleteSuggestion.SuggestionID, actorID); err != nil {
		t.Fatalf("AcceptSuggestion() delete retry: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT body_version FROM documents WHERE id = $1`, documentID).Scan(&bodyVersion); err != nil {
		t.Fatalf("read final body version: %v", err)
	}
	if bodyVersion != 5 {
		t.Fatalf("final body version = %d, want 5", bodyVersion)
	}
	var receiptCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM document_command_receipts WHERE document_id = $1 AND command_id IN ($2, $3, $4)`, documentID, insertSuggestion.SuggestionID, moveSuggestion.SuggestionID, deleteSuggestion.SuggestionID).Scan(&receiptCount); err != nil {
		t.Fatalf("read structural suggestion receipts: %v", err)
	}
	if receiptCount != 3 {
		t.Fatalf("structural suggestion receipts = %d, want 3", receiptCount)
	}
	var receiptEpoch, receiptVersion int64
	var receiptActor uuid.UUID
	var receiptResult string
	if err := db.QueryRowContext(ctx, `SELECT body_epoch, body_version, actor_id, result::text FROM document_command_receipts WHERE document_id = $1 AND command_id = $2`, documentID, deleteSuggestion.SuggestionID).Scan(&receiptEpoch, &receiptVersion, &receiptActor, &receiptResult); err != nil {
		t.Fatalf("read delete suggestion receipt: %v", err)
	}
	if receiptEpoch != 3 || receiptVersion != 5 || receiptActor != actorID {
		t.Fatalf("delete receipt = epoch %d version %d actor %s, want epoch 3 version 5 actor %s", receiptEpoch, receiptVersion, receiptActor, actorID)
	}
	if !strings.Contains(receiptResult, `"bodyEpoch": 4`) || !strings.Contains(receiptResult, `"bodyVersion": 5`) {
		t.Fatalf("delete receipt result = %s, want post-commit epoch 4 and version 5", receiptResult)
	}
	index, err := repo.RebuildRAGIndex(ctx, documentID)
	if err != nil {
		t.Fatalf("RebuildRAGIndex(): %v", err)
	}
	if index.BodyVersion != 5 || index.ChunkCount != 1 || index.CoverageStatus != "complete" {
		t.Fatalf("RAG index = %+v, want version 5, one complete chunk", index)
	}
	chunks, err := repo.SearchRAGChunks(ctx, workspaceID, actorID, "accepted", 10)
	if err != nil || len(chunks) != 1 || chunks[0].NodeID != paragraphID {
		t.Fatalf("SearchRAGChunks() = (%+v, %v), want current paragraph", chunks, err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET body_epoch = body_epoch + 1 WHERE id = $1`, documentID); err != nil {
		t.Fatalf("make RAG index epoch-stale: %v", err)
	}
	chunks, err = repo.SearchRAGChunks(ctx, workspaceID, actorID, "accepted", 10)
	if err != nil || len(chunks) != 0 {
		t.Fatalf("SearchRAGChunks() epoch-stale = (%+v, %v), want no stale chunks", chunks, err)
	}
	lockTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin competing index lock: %v", err)
	}
	defer lockTx.Rollback()
	var lockAcquired bool
	if err := lockTx.QueryRowContext(ctx, `
		SELECT pg_try_advisory_xact_lock(hashtextextended('rag-index:' || $1::text, 0))
	`, documentID).Scan(&lockAcquired); err != nil || !lockAcquired {
		t.Fatalf("acquire competing index lock = (%t, %v), want true", lockAcquired, err)
	}
	skipped, err := repo.RebuildRAGIndex(ctx, documentID)
	if err != nil || skipped.DocumentID != uuid.Nil {
		t.Fatalf("RebuildRAGIndex() with another instance holding lock = (%+v, %v), want skipped", skipped, err)
	}
	if err := lockTx.Commit(); err != nil {
		t.Fatalf("release competing index lock: %v", err)
	}
	rebuilt, err := repo.RebuildStaleRAGIndexes(ctx, 20)
	if err != nil || rebuilt < 1 {
		t.Fatalf("RebuildStaleRAGIndexes() = (%d, %v), want at least one rebuilt document", rebuilt, err)
	}
	chunks, err = repo.SearchRAGChunks(ctx, workspaceID, actorID, "accepted", 10)
	if err != nil || len(chunks) != 1 || chunks[0].NodeID != paragraphID {
		t.Fatalf("SearchRAGChunks() after background rebuild = (%+v, %v), want current paragraph", chunks, err)
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET body_version = body_version + 1 WHERE id = $1`, documentID); err != nil {
		t.Fatalf("make RAG index stale: %v", err)
	}
	chunks, err = repo.SearchRAGChunks(ctx, workspaceID, actorID, "accepted", 10)
	if err != nil {
		t.Fatalf("SearchRAGChunks() stale: %v", err)
	}
	if len(chunks) != 0 {
		t.Fatalf("stale RAG chunks = %+v, want none", chunks)
	}
	pending := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: actorID,
		BaseBodyVersion: 6, BaseBodyEpoch: 5, OperationSchemaVersion: 1,
		Provenance: "human", Operations: []byte(`[{"op":"replace_text"}]`), Summary: "Pending review",
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, pending); err != nil {
		t.Fatalf("CreateSuggestion() pending before revoke: %v", err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, actorID); err != nil {
		t.Fatalf("revoke workspace membership: %v", err)
	}
	unauthorizedCreate := model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: actorID,
		BaseBodyVersion: 6, BaseBodyEpoch: 5, OperationSchemaVersion: 1,
		Provenance: "human", Operations: []byte(`[{"op":"replace_text"}]`), Summary: "Must be rejected",
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, unauthorizedCreate); err == nil {
		t.Error("CreateSuggestion() after access revoke succeeded, want forbidden")
	}
	if err := repo.RejectSuggestion(ctx, workspaceID, documentID, pending.SuggestionID, actorID); err == nil {
		t.Error("RejectSuggestion() after access revoke succeeded, want forbidden")
	}
	if _, err := repo.ListSuggestions(ctx, workspaceID, documentID, actorID); err == nil {
		t.Error("ListSuggestions() after access revoke succeeded, want forbidden")
	}
	var pendingStatus string
	if err := db.QueryRowContext(ctx, `SELECT status FROM document_suggestions WHERE document_id = $1 AND suggestion_id = $2`, documentID, pending.SuggestionID).Scan(&pendingStatus); err != nil || pendingStatus != "pending" {
		t.Errorf("suggestion status after unauthorized reject = %q, error = %v, want pending", pendingStatus, err)
	}
}
