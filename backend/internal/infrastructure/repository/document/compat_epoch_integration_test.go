//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"backend/internal/application/collaboration"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// ADR 0028: a structural command that edits the stored state in place raises
// the body epoch but keeps the history, so a suggester's update made on the
// older epoch still merges. An editor's update does not: it can aim at text in
// a block the command deleted, which would merge and vanish, so it stays stale
// and goes to review. A rebuild moves the compatible epoch up for everyone.
func TestSuggestionFromAnOlderEpochMergesWhileTheHistoryContinues(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	commenterID := insertAccessTestUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, commenterID) })
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, commenterID); err != nil {
		t.Fatalf("add member: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'comment')`, documentID, commenterID); err != nil {
		t.Fatalf("grant comment: %v", err)
	}
	owner := collaboration.Actor{UserID: ownerID}
	commenter := collaboration.Actor{UserID: commenterID}
	persisted, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	// Made on epoch 1: the commenter proposes deleting a word, and the editor
	// types, both before the structural command below.
	suggestionID := uuid.New()
	suggestion := suggestionUpdate(t, persisted, func(tx *crdt.Transaction, text *crdt.YXmlText) {
		text.Format(tx, 0, 3, crdt.Attributes{"suggestion_delete": crdt.Attributes{"id": suggestionID.String(), "author": commenterID.String()}})
	})
	typed := suggestionUpdate(t, persisted, func(tx *crdt.Transaction, text *crdt.YXmlText) {
		text.Insert(tx, 0, "typed early", nil)
	})

	if _, err := repo.DeleteNode(ctx, owner, collaboration.DeleteNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: uuid.New(),
		BodyEpoch: 1, BodySchemaVersion: 1, NodeID: runID,
	}); err != nil {
		t.Fatalf("DeleteNode(): %v", err)
	}
	snapshot, err := repo.ReadBody(ctx, owner, workspaceID, documentID)
	if err != nil || snapshot.BodyEpoch != 2 || snapshot.CompatEpoch != 1 {
		t.Fatalf("after DeleteNode = epoch %d, compat %d, %v; want epoch 2 with the history still compatible from 1", snapshot.BodyEpoch, snapshot.CompatEpoch, err)
	}
	send := func(actor collaboration.Actor, epoch int64, bytes []byte) (collaboration.CommitReceipt, error) {
		return repo.CommitUpdate(ctx, actor, collaboration.Update{
			DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: epoch, BodySchemaVersion: 1, Bytes: bytes,
		})
	}

	receipt, err := send(commenter, 1, suggestion)
	if err != nil {
		t.Fatalf("a suggester's update from epoch 1 while the history continues = %v, want accepted", err)
	}
	if receipt.BodyEpoch != 2 {
		t.Fatalf("receipt epoch = %d, want the current epoch 2 so the author adopts it", receipt.BodyEpoch)
	}
	if _, err := send(owner, 1, typed); !errors.Is(err, collaboration.ErrStaleBodyEpoch) {
		t.Fatalf("an editor's update from epoch 1 = %v, want stale: it may aim at a deleted block", err)
	}

	// An epoch the document has not reached is never accepted.
	if _, err := send(commenter, 3, suggestion); !errors.Is(err, collaboration.ErrStaleBodyEpoch) {
		t.Fatalf("an update from a future epoch = %v, want stale", err)
	}

	// A rebuild starts the history over.
	if _, err := db.ExecContext(ctx, `UPDATE documents SET compat_epoch = body_epoch WHERE id = $1`, documentID); err != nil {
		t.Fatalf("simulate a rebuild: %v", err)
	}
	if _, err := send(commenter, 1, suggestion); !errors.Is(err, collaboration.ErrStaleBodyEpoch) {
		t.Fatalf("a suggester's update from before a rebuild = %v, want stale", err)
	}
}

func TestRestoringARevisionMovesTheCompatibleEpochUp(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	revision, err := repo.CreateNamedDocumentRevision(ctx, documentID, workspaceID, ownerID, "before")
	if err != nil {
		t.Fatalf("CreateNamedDocumentRevision(): %v", err)
	}
	if _, err := repo.DeleteNode(ctx, collaboration.Actor{UserID: ownerID}, collaboration.DeleteNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: uuid.New(),
		BodyEpoch: 1, BodySchemaVersion: 1, NodeID: runID,
	}); err != nil {
		t.Fatalf("DeleteNode(): %v", err)
	}
	read := func() (epoch, compat int64) {
		t.Helper()
		if err := db.QueryRowContext(ctx, `SELECT body_epoch, compat_epoch FROM documents WHERE id = $1`, documentID).Scan(&epoch, &compat); err != nil {
			t.Fatalf("read epochs: %v", err)
		}
		return epoch, compat
	}
	if epoch, compat := read(); epoch != 2 || compat != 1 {
		t.Fatalf("after DeleteNode = epoch %d, compat %d; want 2 and 1", epoch, compat)
	}

	if _, err := repo.RestoreDocumentRevision(ctx, documentID, revision.ID, workspaceID, ownerID, uuid.New()); err != nil {
		t.Fatalf("RestoreDocumentRevision(): %v", err)
	}
	epoch, compat := read()
	if epoch != 3 || compat != epoch {
		t.Fatalf("after restore = epoch %d, compat %d; want a new epoch that is its own compatible start", epoch, compat)
	}

	// The check constraint keeps the pair sane for every writer.
	if _, err := db.ExecContext(ctx, `UPDATE documents SET compat_epoch = body_epoch + 1 WHERE id = $1`, documentID); err == nil {
		t.Fatal("a compatible epoch above the body epoch must be refused")
	}
	if _, err := db.ExecContext(ctx, `UPDATE documents SET compat_epoch = 0 WHERE id = $1`, documentID); err == nil {
		t.Fatal("a compatible epoch below 1 must be refused")
	}
}
