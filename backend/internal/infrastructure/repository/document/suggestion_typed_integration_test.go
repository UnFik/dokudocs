//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func typedSuggestion(documentID, proposerID uuid.UUID, operations string) model.DocumentSuggestion {
	return model.DocumentSuggestion{
		DocumentID: documentID, SuggestionID: uuid.New(), ProposerID: proposerID,
		BaseBodyVersion: 1, BaseBodyEpoch: 1, OperationSchemaVersion: 1, Provenance: "human",
		Operations: []byte(operations),
	}
}

func suggestionStatus(t *testing.T, ctx context.Context, db *sql.DB, documentID, suggestionID uuid.UUID) (string, string) {
	t.Helper()
	var status, reason string
	if err := db.QueryRowContext(ctx, `SELECT status, conflict_reason FROM document_suggestions WHERE document_id = $1 AND suggestion_id = $2`, documentID, suggestionID).Scan(&status, &reason); err != nil {
		t.Fatalf("read suggestion: %v", err)
	}
	return status, reason
}

func TestTypedSuggestionsAcceptAfterUnrelatedBodyChanges(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	first := typedSuggestion(documentID, ownerID, `[{"op":"replace_text","nodeID":"`+runID.String()+`","content":"plain text","baseContent":"plain"}]`)
	second := typedSuggestion(documentID, ownerID, `[{"op":"replace_text","nodeID":"`+runID.String()+`","content":"Plain","baseContent":"plain"}]`)
	for _, suggestion := range []model.DocumentSuggestion{first, second} {
		if err := repo.CreateSuggestion(ctx, workspaceID, suggestion); err != nil {
			t.Fatalf("CreateSuggestion(): %v", err)
		}
	}
	// Another edit elsewhere moved the body version on.
	if _, err := db.ExecContext(ctx, `UPDATE documents SET body_version = 7 WHERE id = $1`, documentID); err != nil {
		t.Fatalf("advance body version: %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, first.SuggestionID, ownerID); err != nil {
		t.Fatalf("AcceptSuggestion() first: %v", err)
	}
	var content string
	var version int64
	if err := db.QueryRowContext(ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, runID).Scan(&content); err != nil {
		t.Fatalf("read run: %v", err)
	}
	if err := db.QueryRowContext(ctx, `SELECT body_version FROM documents WHERE id = $1`, documentID).Scan(&version); err != nil {
		t.Fatalf("read version: %v", err)
	}
	if content != "plain text" || version != 8 {
		t.Fatalf("run = %q at version %d, want \"plain text\" at 8", content, version)
	}

	// The second was typed against text the first one replaced.
	err = repo.AcceptSuggestion(ctx, workspaceID, documentID, second.SuggestionID, ownerID)
	if !errors.Is(err, collaboration.ErrSuggestionConflict) {
		t.Fatalf("AcceptSuggestion() second = %v, want conflict", err)
	}
	if status, reason := suggestionStatus(t, ctx, db, documentID, second.SuggestionID); status != "conflicted" || reason != "changed-text" {
		t.Fatalf("second = %s/%s, want conflicted/changed-text", status, reason)
	}
}

func TestTypedSuggestionDeletesAWholeRun(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	suggestion := typedSuggestion(documentID, ownerID, `[{"op":"delete","nodeID":"`+runID.String()+`","baseContent":"plain"}]`)
	if err := repo.CreateSuggestion(ctx, workspaceID, suggestion); err != nil {
		t.Fatalf("CreateSuggestion(): %v", err)
	}
	if err := repo.AcceptSuggestion(ctx, workspaceID, documentID, suggestion.SuggestionID, ownerID); err != nil {
		t.Fatalf("AcceptSuggestion(): %v", err)
	}
	var count int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, runID).Scan(&count); err != nil {
		t.Fatalf("count run: %v", err)
	}
	if count != 0 {
		t.Fatalf("run still present after accepted deletion")
	}
}

func TestProposerWithdrawsOnlyTheirOwnSuggestion(t *testing.T) {
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
		t.Fatalf("add commenter: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'comment')`, documentID, commenterID); err != nil {
		t.Fatalf("grant comment: %v", err)
	}
	operations := `[{"op":"replace_text","nodeID":"` + runID.String() + `","content":"plain!","baseContent":"plain"}]`
	own := typedSuggestion(documentID, commenterID, operations)
	owners := typedSuggestion(documentID, ownerID, operations)
	if err := repo.CreateSuggestion(ctx, workspaceID, own); err != nil {
		t.Fatalf("CreateSuggestion() commenter: %v", err)
	}
	if err := repo.CreateSuggestion(ctx, workspaceID, owners); err != nil {
		t.Fatalf("CreateSuggestion() owner: %v", err)
	}
	if err := repo.RejectSuggestion(ctx, workspaceID, documentID, owners.SuggestionID, commenterID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("withdraw someone else's = %v, want forbidden", err)
	}
	if status, _ := suggestionStatus(t, ctx, db, documentID, owners.SuggestionID); status != "pending" {
		t.Fatalf("owner's suggestion = %s, want pending", status)
	}
	if err := repo.RejectSuggestion(ctx, workspaceID, documentID, own.SuggestionID, commenterID); err != nil {
		t.Fatalf("withdraw own: %v", err)
	}
	if status, _ := suggestionStatus(t, ctx, db, documentID, own.SuggestionID); status != "rejected" {
		t.Fatalf("own suggestion = %s, want rejected", status)
	}
}
