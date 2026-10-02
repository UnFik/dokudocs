//go:build integration

package document

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func TestSuggestionThreadRepliesAndResolve(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, runID, repo := seedRunDocument(t, ctx, db)
	addMember := func(level string) uuid.UUID {
		id := insertAccessTestUser(t, ctx, db)
		t.Cleanup(func() { _, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id) })
		if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, id); err != nil {
			t.Fatalf("add member: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, $3)`, documentID, id, level); err != nil {
			t.Fatalf("grant %s: %v", level, err)
		}
		return id
	}
	proposerID, otherID := addMember("comment"), addMember("comment")
	suggestion := typedSuggestion(documentID, proposerID, `[{"op":"replace_text","nodeID":"`+runID.String()+`","content":"plain!","baseContent":"plain"}]`)
	if err := repo.CreateSuggestion(ctx, workspaceID, suggestion); err != nil {
		t.Fatalf("CreateSuggestion(): %v", err)
	}
	reply := func(authorID uuid.UUID, body string) model.SuggestionReply {
		return model.SuggestionReply{DocumentID: documentID, SuggestionID: suggestion.SuggestionID, ReplyID: uuid.New(), AuthorID: authorID, Body: body}
	}

	first := reply(proposerID, "why this change")
	if err := repo.CreateSuggestionReply(ctx, workspaceID, first); err != nil {
		t.Fatalf("proposer reply: %v", err)
	}
	if err := repo.CreateSuggestionReply(ctx, workspaceID, first); err != nil {
		t.Fatalf("retrying the same reply must be a no-op: %v", err)
	}
	if err := repo.CreateSuggestionReply(ctx, workspaceID, reply(ownerID, "makes sense")); err != nil {
		t.Fatalf("editor reply: %v", err)
	}
	// Another commenter cannot see the suggestion, so cannot join its thread.
	if err := repo.CreateSuggestionReply(ctx, workspaceID, reply(otherID, "me too")); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("reply by someone who cannot see it = %v, want forbidden", err)
	}
	missing := reply(ownerID, "ghost")
	missing.SuggestionID = uuid.New()
	if err := repo.CreateSuggestionReply(ctx, workspaceID, missing); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("reply to a missing suggestion = %v, want not found", err)
	}

	items, err := repo.ListSuggestions(ctx, workspaceID, documentID, proposerID)
	if err != nil || len(items) != 1 || len(items[0].Replies) != 2 {
		t.Fatalf("ListSuggestions() = (%+v, %v), want one suggestion with two replies", items, err)
	}
	if items[0].Replies[0].Body != "why this change" || items[0].Replies[1].Body != "makes sense" {
		t.Fatalf("replies = %+v, want oldest first", items[0].Replies)
	}
	if hidden, err := repo.ListSuggestions(ctx, workspaceID, documentID, otherID); err != nil || len(hidden) != 0 {
		t.Fatalf("other commenter sees %+v, %v; replies must stay as hidden as the suggestion", hidden, err)
	}

	// Resolving works while pending, never changes the suggestion's status, and
	// is allowed to its proposer and to editors only.
	if err := repo.SetSuggestionResolved(ctx, workspaceID, documentID, suggestion.SuggestionID, otherID, true); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("resolve by someone who cannot see it = %v, want forbidden", err)
	}
	if err := repo.SetSuggestionResolved(ctx, workspaceID, documentID, suggestion.SuggestionID, proposerID, true); err != nil {
		t.Fatalf("resolve by proposer: %v", err)
	}
	items, _ = repo.ListSuggestions(ctx, workspaceID, documentID, ownerID)
	if items[0].Status != "pending" || items[0].ResolvedAt == nil || items[0].ResolvedBy == nil || *items[0].ResolvedBy != proposerID {
		t.Fatalf("after resolve = %+v, want pending, resolved by the proposer", items[0])
	}
	var content string
	if err := db.QueryRowContext(ctx, `SELECT content FROM document_nodes WHERE document_id = $1 AND node_id = $2`, documentID, runID).Scan(&content); err != nil || content != "plain" {
		t.Fatalf("body after resolve = %q, %v; resolve must not touch the text", content, err)
	}
	if err := repo.SetSuggestionResolved(ctx, workspaceID, documentID, suggestion.SuggestionID, ownerID, true); err != nil {
		t.Fatalf("resolving twice must be a no-op: %v", err)
	}
	items, _ = repo.ListSuggestions(ctx, workspaceID, documentID, ownerID)
	if items[0].ResolvedBy == nil || *items[0].ResolvedBy != proposerID {
		t.Fatalf("second resolve changed who resolved it: %+v", items[0].ResolvedBy)
	}

	// A new reply reopens the thread; so does an explicit reopen.
	if err := repo.CreateSuggestionReply(ctx, workspaceID, reply(ownerID, "one more thing")); err != nil {
		t.Fatalf("reply to a resolved thread: %v", err)
	}
	items, _ = repo.ListSuggestions(ctx, workspaceID, documentID, ownerID)
	if items[0].ResolvedAt != nil || len(items[0].Replies) != 3 {
		t.Fatalf("after replying = resolvedAt %v, %d replies, want reopened with three", items[0].ResolvedAt, len(items[0].Replies))
	}
	if err := repo.SetSuggestionResolved(ctx, workspaceID, documentID, suggestion.SuggestionID, ownerID, true); err != nil {
		t.Fatalf("resolve by editor: %v", err)
	}
	if err := repo.SetSuggestionResolved(ctx, workspaceID, documentID, suggestion.SuggestionID, proposerID, false); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	items, _ = repo.ListSuggestions(ctx, workspaceID, documentID, ownerID)
	if items[0].ResolvedAt != nil || items[0].ResolvedBy != nil {
		t.Fatalf("after reopen = %+v, want open", items[0])
	}
	if err := repo.SetSuggestionResolved(ctx, workspaceID, documentID, uuid.New(), ownerID, true); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("resolve a missing suggestion = %v, want not found", err)
	}
}
