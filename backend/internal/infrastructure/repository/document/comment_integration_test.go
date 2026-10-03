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

func TestCommentThreadsRepliesAndResolve(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, _, repo := seedRunDocument(t, ctx, db)
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
	commenterID, viewerID := addMember("comment"), addMember("view")

	thread := model.CommentThread{
		ID: uuid.New(), DocumentID: documentID, AuthorID: commenterID,
		SelectedText: "plain", Content: "is this right?", Anchor: []byte(`{"nodeID":"x","start":"AA==","end":"AQ=="}`),
	}
	if err := repo.CreateComment(ctx, workspaceID, thread); err != nil {
		t.Fatalf("commenter starts a thread: %v", err)
	}
	if err := repo.CreateComment(ctx, workspaceID, thread); err != nil {
		t.Fatalf("retrying the same thread must be a no-op: %v", err)
	}
	denied := thread
	denied.ID, denied.AuthorID = uuid.New(), viewerID
	if err := repo.CreateComment(ctx, workspaceID, denied); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("thread by a viewer = %v, want forbidden", err)
	}

	reply := func(authorID uuid.UUID, content string) model.CommentReply {
		return model.CommentReply{ID: uuid.New(), ThreadID: thread.ID, AuthorID: authorID, Content: content}
	}
	first := reply(ownerID, "yes")
	if err := repo.CreateCommentReply(ctx, workspaceID, documentID, first); err != nil {
		t.Fatalf("editor replies: %v", err)
	}
	if err := repo.CreateCommentReply(ctx, workspaceID, documentID, first); err != nil {
		t.Fatalf("retrying the same reply must be a no-op: %v", err)
	}
	if err := repo.CreateCommentReply(ctx, workspaceID, documentID, reply(viewerID, "me too")); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("reply by a viewer = %v, want forbidden", err)
	}
	ghost := reply(ownerID, "ghost")
	ghost.ThreadID = uuid.New()
	if err := repo.CreateCommentReply(ctx, workspaceID, documentID, ghost); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("reply to a missing thread = %v, want not found", err)
	}

	for name, actor := range map[string]uuid.UUID{"owner": ownerID, "commenter": commenterID, "viewer": viewerID} {
		items, err := repo.ListComments(ctx, workspaceID, documentID, actor)
		if err != nil || len(items) != 1 || len(items[0].Replies) != 1 {
			t.Fatalf("%s sees %+v, %v; readers must see the thread and its reply", name, items, err)
		}
		if items[0].AuthorName == "" || items[0].Replies[0].AuthorName == "" || len(items[0].Anchor) == 0 {
			t.Fatalf("%s sees %+v, want names and the anchor", name, items[0])
		}
	}

	if err := repo.SetCommentResolved(ctx, workspaceID, documentID, thread.ID, viewerID, true); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("resolve by a viewer = %v, want forbidden", err)
	}
	if err := repo.SetCommentResolved(ctx, workspaceID, documentID, thread.ID, commenterID, true); err != nil {
		t.Fatalf("resolve by the commenter: %v", err)
	}
	items, _ := repo.ListComments(ctx, workspaceID, documentID, ownerID)
	if items[0].ResolvedAt == nil || items[0].ResolvedBy == nil || *items[0].ResolvedBy != commenterID {
		t.Fatalf("after resolve = %+v, want resolved by the commenter", items[0])
	}
	if err := repo.CreateCommentReply(ctx, workspaceID, documentID, reply(ownerID, "one more thing")); err != nil {
		t.Fatalf("reply to a resolved thread: %v", err)
	}
	items, _ = repo.ListComments(ctx, workspaceID, documentID, ownerID)
	if items[0].ResolvedAt != nil || len(items[0].Replies) != 2 {
		t.Fatalf("after replying = %+v, want reopened with two replies", items[0])
	}
	if err := repo.SetCommentResolved(ctx, workspaceID, documentID, thread.ID, ownerID, true); err != nil {
		t.Fatalf("resolve by the editor: %v", err)
	}
	if err := repo.SetCommentResolved(ctx, workspaceID, documentID, thread.ID, commenterID, false); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	items, _ = repo.ListComments(ctx, workspaceID, documentID, ownerID)
	if items[0].ResolvedAt != nil {
		t.Fatalf("after reopen = %+v, want open", items[0])
	}
	if err := repo.SetCommentResolved(ctx, workspaceID, documentID, uuid.New(), ownerID, true); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("resolve a missing thread = %v, want not found", err)
	}

	// A thread of another document cannot be reached through this one, even by
	// someone who may comment there.
	otherWorkspaceID, otherDocumentID, otherOwnerID, _, _, _ := seedRunDocument(t, ctx, db)
	if err := repo.CreateCommentReply(ctx, otherWorkspaceID, otherDocumentID, reply(otherOwnerID, "wrong document")); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("reply through another document = %v, want not found", err)
	}
	if err := repo.SetCommentResolved(ctx, otherWorkspaceID, otherDocumentID, thread.ID, otherOwnerID, true); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("resolve through another document = %v, want not found", err)
	}
}

func TestCommentEditAndDelete(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()
	workspaceID, documentID, ownerID, _, _, repo := seedRunDocument(t, ctx, db)
	add := func(level string) uuid.UUID {
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
	authorID, otherID, viewerID := add("comment"), add("comment"), add("view")
	thread := model.CommentThread{ID: uuid.New(), DocumentID: documentID, AuthorID: authorID, SelectedText: "x", Content: "first draft"}
	if err := repo.CreateComment(ctx, workspaceID, thread); err != nil {
		t.Fatalf("create: %v", err)
	}
	reply := model.CommentReply{ID: uuid.New(), ThreadID: thread.ID, AuthorID: otherID, Content: "a reply"}
	if err := repo.CreateCommentReply(ctx, workspaceID, documentID, reply); err != nil {
		t.Fatalf("reply: %v", err)
	}
	read := func() model.CommentThread {
		t.Helper()
		items, err := repo.ListComments(ctx, workspaceID, documentID, ownerID)
		if err != nil || len(items) != 1 {
			t.Fatalf("ListComments() = (%+v, %v), want one thread", items, err)
		}
		return items[0]
	}
	if read().EditedAt != nil || read().Replies[0].EditedAt != nil {
		t.Fatal("nothing was edited yet")
	}

	// Only the author edits.
	for name, actor := range map[string]uuid.UUID{"another commenter": otherID, "an editor": ownerID, "a viewer": viewerID} {
		if err := repo.UpdateComment(ctx, workspaceID, documentID, thread.ID, actor, "hijacked"); !errors.Is(err, constant.ErrForbidden) {
			t.Fatalf("%s editing a thread = %v, want forbidden", name, err)
		}
	}
	if err := repo.UpdateComment(ctx, workspaceID, documentID, thread.ID, authorID, "second draft"); err != nil {
		t.Fatalf("author edits the thread: %v", err)
	}
	if got := read(); got.Content != "second draft" || got.EditedAt == nil {
		t.Fatalf("after the edit = %+v, want new text marked edited", got)
	}
	if err := repo.UpdateCommentReply(ctx, workspaceID, documentID, thread.ID, reply.ID, authorID, "hijacked"); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("editing someone else's reply = %v, want forbidden", err)
	}
	if err := repo.UpdateCommentReply(ctx, workspaceID, documentID, thread.ID, reply.ID, otherID, "a better reply"); err != nil {
		t.Fatalf("author edits the reply: %v", err)
	}
	if got := read().Replies[0]; got.Content != "a better reply" || got.EditedAt == nil {
		t.Fatalf("reply after the edit = %+v, want new text marked edited", got)
	}
	// Resolving or replying is not an edit.
	if err := repo.SetCommentResolved(ctx, workspaceID, documentID, thread.ID, ownerID, true); err != nil {
		t.Fatalf("resolve: %v", err)
	}

	// A thread of another document is out of reach.
	otherWorkspaceID, otherDocumentID, otherOwnerID, _, _, _ := seedRunDocument(t, ctx, db)
	if err := repo.UpdateComment(ctx, otherWorkspaceID, otherDocumentID, thread.ID, otherOwnerID, "x"); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("editing through another document = %v, want not found", err)
	}
	if err := repo.DeleteComment(ctx, otherWorkspaceID, otherDocumentID, thread.ID, otherOwnerID); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("deleting through another document = %v, want not found", err)
	}

	// Deleting: the author or an editor, not another commenter or a viewer.
	if err := repo.DeleteCommentReply(ctx, workspaceID, documentID, thread.ID, reply.ID, authorID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("another commenter deleting a reply = %v, want forbidden", err)
	}
	if err := repo.DeleteCommentReply(ctx, workspaceID, documentID, thread.ID, reply.ID, otherID); err != nil {
		t.Fatalf("reply author deletes it: %v", err)
	}
	if len(read().Replies) != 0 {
		t.Fatal("the reply should be gone")
	}
	for name, actor := range map[string]uuid.UUID{"another commenter": otherID, "a viewer": viewerID} {
		if err := repo.DeleteComment(ctx, workspaceID, documentID, thread.ID, actor); !errors.Is(err, constant.ErrForbidden) {
			t.Fatalf("%s deleting a thread = %v, want forbidden", name, err)
		}
	}
	if err := repo.DeleteComment(ctx, workspaceID, documentID, thread.ID, ownerID); err != nil {
		t.Fatalf("an editor deletes the thread: %v", err)
	}
	if items, _ := repo.ListComments(ctx, workspaceID, documentID, ownerID); len(items) != 0 {
		t.Fatalf("after deleting = %+v, want no threads", items)
	}
	if err := repo.DeleteComment(ctx, workspaceID, documentID, thread.ID, ownerID); !errors.Is(err, constant.ErrDocumentNotFound) {
		t.Fatalf("deleting twice = %v, want not found", err)
	}
	// The author may delete their own thread.
	again := model.CommentThread{ID: uuid.New(), DocumentID: documentID, AuthorID: authorID, SelectedText: "x", Content: "mine"}
	if err := repo.CreateComment(ctx, workspaceID, again); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := repo.DeleteComment(ctx, workspaceID, documentID, again.ID, authorID); err != nil {
		t.Fatalf("author deletes their own thread: %v", err)
	}
}
