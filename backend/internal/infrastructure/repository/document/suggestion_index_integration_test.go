//go:build integration

package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// The index keeps one row per suggestion, made from what the collaboration
// service stores: pending while the suggestion is in the document, closed when
// it leaves, pending again if it comes back (undo).
func TestSuggestionIndexFollowsTheStoredDocument(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, _, _ := seedRunDocument(t, ctx, db)
	store := NewCollabStateStore(database.NewSQLDB(db))
	put := func(suggestions ...collaboration.Suggestion) {
		t.Helper()
		if err := store.StoreState(ctx, workspaceID, documentID, []byte{1}, json.RawMessage(`{"type":"doc"}`), "", suggestions); err != nil {
			t.Fatalf("StoreState(): %v", err)
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
	mine := collaboration.Suggestion{ID: suggestionID, Author: ownerID}

	put(mine)
	if got := status(suggestionID); got != "pending" {
		t.Fatalf("after proposing, index row = %q, want pending", got)
	}
	put()
	if got := status(suggestionID); got != "closed" {
		t.Fatalf("after the suggestion left the document, index row = %q, want closed", got)
	}
	put(mine)
	if got := status(suggestionID); got != "pending" {
		t.Fatalf("after the suggestion came back, index row = %q, want pending", got)
	}

	// An author that is not a user gets no row, and does not fail the store.
	forged := collaboration.Suggestion{ID: uuid.New(), Author: uuid.New()}
	put(mine, forged)
	if got := status(forged.ID); got != "none" {
		t.Fatalf("forged author index row = %q, want none", got)
	}
}
