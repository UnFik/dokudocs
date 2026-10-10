//go:build integration

package document

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type mentionFixture struct {
	t                    *testing.T
	ctx                  context.Context
	db                   *sql.DB
	repo                 *Repository
	workspaceID          uuid.UUID
	documentID           uuid.UUID
	ownerID, commenterID uuid.UUID
}

func newMentionFixture(t *testing.T) *mentionFixture {
	t.Helper()
	ctx := context.Background()
	db, err := sql.Open("pgx", integrationDatabaseURL(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	workspaceID, documentID, ownerID, _, _, repo := seedRunDocument(t, ctx, db)
	commenterID := insertAccessTestUser(t, ctx, db)
	t.Cleanup(func() { _, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, commenterID) })
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, commenterID); err != nil {
		t.Fatalf("add member: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'comment')`, documentID, commenterID); err != nil {
		t.Fatalf("grant comment: %v", err)
	}
	return &mentionFixture{t: t, ctx: ctx, db: db, repo: repo, workspaceID: workspaceID, documentID: documentID, ownerID: ownerID, commenterID: commenterID}
}

func (f *mentionFixture) rows(userID uuid.UUID) (count, unread int) {
	f.t.Helper()
	if err := f.db.QueryRowContext(f.ctx, `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE read_at IS NULL) FROM notifications
		WHERE user_id = $1 AND kind = 'comment_mention'`, userID).Scan(&count, &unread); err != nil {
		f.t.Fatalf("count notifications: %v", err)
	}
	return count, unread
}

func (f *mentionFixture) thread(content string, mentioned ...uuid.UUID) model.CommentThread {
	return model.CommentThread{
		ID: uuid.New(), DocumentID: f.documentID, AuthorID: f.ownerID,
		SelectedText: "plain", Content: content, Mentioned: mentioned,
		Anchor: []byte(`{"nodeID":"x","start":"AA==","end":"AQ=="}`),
	}
}

func TestMentionNotifiesOnceAndOnEveryEdit(t *testing.T) {
	f := newMentionFixture(t)
	thread := f.thread("see @[Access Integration Test](user:"+f.commenterID.String()+")", f.commenterID)

	deliveries, err := f.repo.CreateComment(f.ctx, f.workspaceID, thread)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if len(deliveries) != 1 || deliveries[0].UserID != f.commenterID || !deliveries[0].SendEmail || !deliveries[0].SendPush {
		t.Fatalf("deliveries = %+v, want one to the commenter by email and push", deliveries)
	}
	if got := deliveries[0]; got.Email == "" || !strings.Contains(got.Title, "Access Integration Test") ||
		!strings.Contains(got.Body, "see @Access Integration Test") || strings.Contains(got.Body, "user:") ||
		got.Path != "/docs/"+f.documentID.String()+"?workspaceId="+f.workspaceID.String()+"&thread="+thread.ID.String() {
		t.Fatalf("delivery text = %+v", got)
	}
	var documentID, threadID, commentID uuid.UUID
	if err := f.db.QueryRowContext(f.ctx, `SELECT document_id, thread_id, comment_id FROM notifications WHERE user_id = $1`, f.commenterID).Scan(&documentID, &threadID, &commentID); err != nil {
		t.Fatalf("read the notification: %v", err)
	}
	if documentID != f.documentID || threadID != thread.ID || commentID != thread.ID {
		t.Fatalf("notification points at %v %v %v", documentID, threadID, commentID)
	}

	// Sending the same thread again changes nothing.
	again, err := f.repo.CreateComment(f.ctx, f.workspaceID, thread)
	if err != nil || len(again) != 0 {
		t.Fatalf("retry = %+v, %v, want no delivery", again, err)
	}
	if count, _ := f.rows(f.commenterID); count != 1 {
		t.Fatalf("%d notifications after a retry, want 1", count)
	}

	// An edit tells them again, on the same open notification, without a second email.
	edited, err := f.repo.UpdateComment(f.ctx, f.workspaceID, f.documentID, thread.ID, f.ownerID, "edited @[X](user:"+f.commenterID.String()+")", []uuid.UUID{f.commenterID})
	if err != nil {
		t.Fatalf("edit: %v", err)
	}
	if len(edited) != 0 {
		t.Fatalf("an edit just after sent %+v, want email and push held back", edited)
	}
	if count, unread := f.rows(f.commenterID); count != 1 || unread != 1 {
		t.Fatalf("%d notifications (%d unread) after an edit, want the same one", count, unread)
	}
	var body string
	if err := f.db.QueryRowContext(f.ctx, `SELECT body FROM notifications WHERE user_id = $1`, f.commenterID).Scan(&body); err != nil || !strings.Contains(body, "edited") {
		t.Fatalf("the open notification reads %q, %v, want the edited text", body, err)
	}

	// Ten minutes on, an edit is worth another email.
	if _, err := f.db.ExecContext(f.ctx, `UPDATE notifications SET delivered_at = NOW() - INTERVAL '11 minutes' WHERE user_id = $1`, f.commenterID); err != nil {
		t.Fatal(err)
	}
	later, err := f.repo.UpdateComment(f.ctx, f.workspaceID, f.documentID, thread.ID, f.ownerID, "edited twice @[X](user:"+f.commenterID.String()+")", []uuid.UUID{f.commenterID})
	if err != nil || len(later) != 1 {
		t.Fatalf("a later edit = %+v, %v, want one delivery", later, err)
	}

	// Once it has been read, the next edit is a new notification.
	if _, err := f.db.ExecContext(f.ctx, `UPDATE notifications SET read_at = NOW() WHERE user_id = $1`, f.commenterID); err != nil {
		t.Fatal(err)
	}
	afterRead, err := f.repo.UpdateComment(f.ctx, f.workspaceID, f.documentID, thread.ID, f.ownerID, "third @[X](user:"+f.commenterID.String()+")", []uuid.UUID{f.commenterID})
	if err != nil || len(afterRead) != 1 {
		t.Fatalf("an edit after reading = %+v, %v, want one delivery", afterRead, err)
	}
	if count, unread := f.rows(f.commenterID); count != 2 || unread != 1 {
		t.Fatalf("%d notifications (%d unread), want the read one and a new one", count, unread)
	}
}

func TestMentionOfOneselfAndRepliesAndPreferences(t *testing.T) {
	f := newMentionFixture(t)
	thread := f.thread("note to self", f.ownerID)
	if deliveries, err := f.repo.CreateComment(f.ctx, f.workspaceID, thread); err != nil || len(deliveries) != 0 {
		t.Fatalf("mentioning oneself = %+v, %v, want nothing", deliveries, err)
	}
	if count, _ := f.rows(f.ownerID); count != 0 {
		t.Fatalf("%d notifications for oneself, want none", count)
	}

	// A reply that names someone is its own message.
	reply := model.CommentReply{ID: uuid.New(), ThreadID: thread.ID, AuthorID: f.ownerID, Content: "@[X](user:" + f.commenterID.String() + ")", Mentioned: []uuid.UUID{f.commenterID}}
	deliveries, err := f.repo.CreateCommentReply(f.ctx, f.workspaceID, f.documentID, reply)
	if err != nil || len(deliveries) != 1 {
		t.Fatalf("reply = %+v, %v, want one delivery", deliveries, err)
	}
	var commentID uuid.UUID
	if err := f.db.QueryRowContext(f.ctx, `SELECT comment_id FROM notifications WHERE user_id = $1`, f.commenterID).Scan(&commentID); err != nil || commentID != reply.ID {
		t.Fatalf("comment_id = %v, %v, want the reply %v", commentID, err, reply.ID)
	}

	// Email and push off: still in the app, nothing sent.
	if _, err := f.db.ExecContext(f.ctx, `INSERT INTO user_settings (user_id, notification_prefs) VALUES ($1, '{"email": false, "in_app": true, "push": false}')
		ON CONFLICT (user_id) DO UPDATE SET notification_prefs = EXCLUDED.notification_prefs`, f.commenterID); err != nil {
		t.Fatalf("set preferences: %v", err)
	}
	second := f.thread("again", f.commenterID)
	got, err := f.repo.CreateComment(f.ctx, f.workspaceID, second)
	if err != nil || len(got) != 0 {
		t.Fatalf("with email and push off = %+v, %v, want nothing to send", got, err)
	}
	if count, _ := f.rows(f.commenterID); count != 2 {
		t.Fatalf("%d notifications, want it still in the app", count)
	}

	// In-app off: no notification row at all.
	if _, err := f.db.ExecContext(f.ctx, `UPDATE user_settings SET notification_prefs = '{"email": true, "in_app": false}' WHERE user_id = $1`, f.commenterID); err != nil {
		t.Fatal(err)
	}
	before, _ := f.rows(f.commenterID)
	third := f.thread("third", f.commenterID)
	got, err = f.repo.CreateComment(f.ctx, f.workspaceID, third)
	if err != nil || len(got) != 1 || !got[0].SendEmail {
		t.Fatalf("with in-app off = %+v, %v, want the email still sent", got, err)
	}
	if after, _ := f.rows(f.commenterID); after != before {
		t.Fatalf("%d notifications, want %d: in-app is off", after, before)
	}
}
