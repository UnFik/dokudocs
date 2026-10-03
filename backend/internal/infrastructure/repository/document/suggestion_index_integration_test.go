//go:build integration

package document

import (
	"context"
	"database/sql"
	"testing"

	"backend/internal/application/collaboration"

	"github.com/google/uuid"
	"github.com/reearth/ygo/crdt"
)

// The server keeps one index row per suggestion, made from the Yjs updates it
// commits: pending while the suggestion is in the body, closed when it leaves,
// pending again if it comes back (undo).
func TestSuggestionIndexFollowsTheBody(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	_, documentID, ownerID, _, _, repo := seedRunDocument(t, ctx, db)
	commit := func(edit func(tx *crdt.Transaction, text *crdt.YXmlText)) {
		t.Helper()
		persisted, err := readCollaborationState(ctx, db, documentID)
		if err != nil {
			t.Fatalf("read state: %v", err)
		}
		_, err = repo.CommitUpdate(ctx, collaboration.Actor{UserID: ownerID}, collaboration.Update{
			DocumentID: documentID, UpdateID: uuid.New(), BodyEpoch: 1, BodySchemaVersion: 1,
			Bytes: suggestionUpdate(t, persisted, edit),
		})
		if err != nil {
			t.Fatalf("CommitUpdate(): %v", err)
		}
	}
	status := func(id uuid.UUID) string {
		t.Helper()
		var got string
		err := db.QueryRowContext(ctx, `SELECT status FROM document_suggestions WHERE document_id = $1 AND suggestion_id = $2`, documentID, id).Scan(&got)
		if err == sql.ErrNoRows {
			return "none"
		}
		if err != nil {
			t.Fatalf("read index row: %v", err)
		}
		return got
	}
	suggestionID := uuid.New()
	mark := func(author uuid.UUID) crdt.Attributes {
		return crdt.Attributes{"suggestion_delete": crdt.Attributes{"id": suggestionID.String(), "author": author.String()}}
	}

	commit(func(tx *crdt.Transaction, text *crdt.YXmlText) { text.Format(tx, 0, 5, mark(ownerID)) })
	if got := status(suggestionID); got != "pending" {
		t.Fatalf("after proposing, index row = %q, want pending", got)
	}
	commit(func(tx *crdt.Transaction, text *crdt.YXmlText) {
		text.Format(tx, 0, 5, crdt.Attributes{"suggestion_delete": nil})
	})
	if got := status(suggestionID); got != "closed" {
		t.Fatalf("after the suggestion left the body, index row = %q, want closed", got)
	}
	commit(func(tx *crdt.Transaction, text *crdt.YXmlText) { text.Format(tx, 0, 5, mark(ownerID)) })
	if got := status(suggestionID); got != "pending" {
		t.Fatalf("after the suggestion came back, index row = %q, want pending", got)
	}

	// An author that is not a user gets no row, and does not fail the commit.
	forged := uuid.New()
	suggestionID = uuid.New()
	commit(func(tx *crdt.Transaction, text *crdt.YXmlText) { text.Format(tx, 0, 5, mark(forged)) })
	if got := status(suggestionID); got != "none" {
		t.Fatalf("forged author index row = %q, want none", got)
	}
}
