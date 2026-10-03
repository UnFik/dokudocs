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
// the body epoch but keeps the history, so an update made on the older epoch
// still merges. A rebuild moves the compatible epoch up, and older updates
// are stale again.
func TestUpdateFromAnOlderEpochMergesWhileTheHistoryContinues(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	actor := collaboration.Actor{UserID: ownerID}
	persisted, err := readCollaborationState(ctx, db, documentID)
	if err != nil {
		t.Fatalf("read state: %v", err)
	}
	// Made on epoch 1, before the structural command below.
	earlier := suggestionUpdate(t, persisted, func(tx *crdt.Transaction, text *crdt.YXmlText) {
		text.Insert(tx, 0, "typed early", nil)
	})

	if _, err := repo.DeleteNode(ctx, actor, collaboration.DeleteNodeCommand{
		WorkspaceID: workspaceID, DocumentID: documentID, CommandID: uuid.New(),
		BodyEpoch: 1, BodySchemaVersion: 1, NodeID: runID,
	}); err != nil {
		t.Fatalf("DeleteNode(): %v", err)
	}
	snapshot, err := repo.ReadBody(ctx, actor, workspaceID, documentID)
	if err != nil || snapshot.BodyEpoch != 2 || snapshot.CompatEpoch != 1 {
		t.Fatalf("after DeleteNode = epoch %d, compat %d, %v; want epoch 2 with the history still compatible from 1", snapshot.BodyEpoch, snapshot.CompatEpoch, err)
	}

	receipt, err := repo.CommitUpdate(ctx, actor, collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: earlier,
	})
	if err != nil {
		t.Fatalf("CommitUpdate() from epoch 1 while the history continues = %v, want accepted", err)
	}
	if receipt.BodyEpoch != 2 {
		t.Fatalf("receipt epoch = %d, want the current epoch 2 so the author adopts it", receipt.BodyEpoch)
	}

	// An epoch the document has not reached is never accepted.
	if _, err := repo.CommitUpdate(ctx, actor, collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 3, BodySchemaVersion: 1, Bytes: earlier,
	}); !errors.Is(err, collaboration.ErrStaleBodyEpoch) {
		t.Fatalf("CommitUpdate() from a future epoch = %v, want stale", err)
	}

	// A rebuild starts the history over.
	if _, err := db.ExecContext(ctx, `UPDATE documents SET compat_epoch = body_epoch WHERE id = $1`, documentID); err != nil {
		t.Fatalf("simulate a rebuild: %v", err)
	}
	if _, err := repo.CommitUpdate(ctx, actor, collaboration.Update{
		DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1, Bytes: earlier,
	}); !errors.Is(err, collaboration.ErrStaleBodyEpoch) {
		t.Fatalf("CommitUpdate() from before a rebuild = %v, want stale", err)
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
