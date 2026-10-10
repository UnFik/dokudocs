//go:build integration

package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"

	appcatalog "backend/internal/application/catalog"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func member(t *testing.T, db *sql.DB) (userID, workspaceID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	if err := db.QueryRowContext(ctx, `INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Catalog test') RETURNING id`,
		uuid.NewString(), fmt.Sprintf("catalog-%s@example.invalid", uuid.NewString())).Scan(&userID); err != nil {
		t.Fatalf("user: %v", err)
	}
	workspaceID = uuid.New()
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Catalog', $2, $3)`, workspaceID, "catalog-"+workspaceID.String(), userID); err != nil {
		t.Fatalf("workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, userID); err != nil {
		t.Fatalf("member: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})
	return userID, workspaceID
}

func TestTheCatalogHoldsTheSeededEntries(t *testing.T) {
	entries, err := NewStore(database.NewSQLDB(openDB(t))).ListEntries(context.Background())
	if err != nil {
		t.Fatalf("ListEntries(): %v", err)
	}
	if len(entries) != 304 {
		t.Fatalf("entries = %d, want 304 (274 Hosts and Systems, 30 protocols)", len(entries))
	}
	bySlug := map[string]appcatalog.Entry{}
	for _, e := range entries {
		bySlug[e.Slug] = e
	}
	if e := bySlug["golang"]; e.Name != "Go" || e.Category != "system" || e.Subkind != "language" || e.Family != nil {
		t.Fatalf("golang = %+v", e)
	}
	if e := bySlug["aws-rds"]; e.Name != "AWS RDS" || e.Category != "host" || e.Subkind != "aws" {
		t.Fatalf("aws-rds = %+v", e)
	}
	if e := bySlug["subscribe"]; e.Category != "protocol" || e.Family == nil || *e.Family != "message" {
		t.Fatalf("subscribe = %+v", e)
	}
}

func TestFindingAnEntryByNameOrSlug(t *testing.T) {
	store := NewStore(database.NewSQLDB(openDB(t)))
	for key, want := range map[string]string{"postgresql": "postgresql", "awsrds": "aws-rds", "midtrans": "midtrans", "notathing": ""} {
		if got, err := store.FindEntry(context.Background(), key); err != nil || got != want {
			t.Fatalf("FindEntry(%q) = (%q, %v), want %q", key, got, err, want)
		}
	}
}

func TestRequestsWithTheSameNameBecomeVotes(t *testing.T) {
	db := openDB(t)
	store := NewStore(database.NewSQLDB(db))
	ctx := context.Background()
	alice, workspace := member(t, db)
	bob, otherWorkspace := member(t, db)
	key := "acme" + uuid.NewString()[:8]
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM catalog_requests WHERE name_key = $1`, key)
	})

	first, err := store.AddRequest(ctx, appcatalog.RequestInput{UserID: alice, WorkspaceID: workspace, Name: "Acme Queue", Category: "system"}, key)
	if err != nil || first.Votes != 1 || first.AlreadyRequested {
		t.Fatalf("first = (%+v, %v), want a new request with one vote", first, err)
	}
	again, err := store.AddRequest(ctx, appcatalog.RequestInput{UserID: alice, WorkspaceID: workspace, Name: "acme queue", Category: "system"}, key)
	if err != nil || again.ID != first.ID || again.Votes != 1 || !again.AlreadyRequested {
		t.Fatalf("same person again = (%+v, %v), want the same request, still one vote", again, err)
	}
	other, err := store.AddRequest(ctx, appcatalog.RequestInput{UserID: bob, WorkspaceID: otherWorkspace, Name: "ACME-Queue", Category: "system"}, key)
	if err != nil || other.ID != first.ID || other.Votes != 2 || !other.AlreadyRequested {
		t.Fatalf("someone else = (%+v, %v), want the same request with two votes", other, err)
	}
}

func TestOnlyAMemberOfTheWorkspaceMayRequest(t *testing.T) {
	db := openDB(t)
	alice, _ := member(t, db)
	_, foreign := member(t, db)
	_, err := NewStore(database.NewSQLDB(db)).AddRequest(context.Background(), appcatalog.RequestInput{UserID: alice, WorkspaceID: foreign, Name: "X", Category: "host"}, "x"+uuid.NewString()[:8])
	if !errors.Is(err, appcatalog.ErrNotMember) {
		t.Fatalf("error = %v, want ErrNotMember", err)
	}
}

func TestOnePersonHasAtMostTwentyOpenRequests(t *testing.T) {
	db := openDB(t)
	store := NewStore(database.NewSQLDB(db))
	ctx := context.Background()
	alice, workspace := member(t, db)
	prefix := "limit" + uuid.NewString()[:8]
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM catalog_requests WHERE name_key LIKE $1`, prefix+"%")
	})
	for i := 0; i < appcatalog.MaxOpenRequests; i++ {
		if _, err := store.AddRequest(ctx, appcatalog.RequestInput{UserID: alice, WorkspaceID: workspace, Name: fmt.Sprintf("N%d", i), Category: "system"}, fmt.Sprintf("%s%d", prefix, i)); err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
	}
	_, err := store.AddRequest(ctx, appcatalog.RequestInput{UserID: alice, WorkspaceID: workspace, Name: "One more", Category: "system"}, prefix+"more")
	if !errors.Is(err, appcatalog.ErrTooManyRequests) {
		t.Fatalf("21st request error = %v, want ErrTooManyRequests", err)
	}
}

func platformAdmin(t *testing.T, db *sql.DB, userID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `INSERT INTO roles (name, slug, is_system) VALUES ('Administrator', 'admin', true) ON CONFLICT (slug) DO NOTHING`); err != nil {
		t.Fatalf("role: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = 'admin'`, userID); err != nil {
		t.Fatalf("grant admin: %v", err)
	}
}

func TestAnAdminAnswersARequestAndEveryVoterIsNotified(t *testing.T) {
	db := openDB(t)
	store := NewStore(database.NewSQLDB(db))
	ctx := context.Background()
	alice, ws := member(t, db)
	bob, ws2 := member(t, db)
	admin, _ := member(t, db)
	platformAdmin(t, db, admin)
	key := "review" + uuid.NewString()[:8]
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM catalog_requests WHERE name_key = $1`, key)
	})
	first, _ := store.AddRequest(ctx, appcatalog.RequestInput{UserID: alice, WorkspaceID: ws, Name: "Acme MQ", Category: "system"}, key)
	if _, err := store.AddRequest(ctx, appcatalog.RequestInput{UserID: bob, WorkspaceID: ws2, Name: "Acme MQ", Category: "system"}, key); err != nil {
		t.Fatalf("vote: %v", err)
	}

	if _, err := store.OpenRequests(ctx, alice); !errors.Is(err, appcatalog.ErrNotAdmin) {
		t.Fatalf("a member lists open requests: %v, want ErrNotAdmin", err)
	}
	open, err := store.OpenRequests(ctx, admin)
	if err != nil {
		t.Fatalf("OpenRequests(): %v", err)
	}
	var found *appcatalog.OpenRequest
	for i := range open {
		if open[i].ID == first.ID {
			found = &open[i]
		}
	}
	if found == nil || found.Votes != 2 {
		t.Fatalf("open = %+v, want the request with 2 votes", open)
	}
	if err := store.AnswerRequest(ctx, alice, first.ID, appcatalog.Answer{Status: "declined", Reason: "x"}); !errors.Is(err, appcatalog.ErrNotAdmin) {
		t.Fatalf("a member answers: %v, want ErrNotAdmin", err)
	}
	if err := store.AnswerRequest(ctx, admin, first.ID, appcatalog.Answer{Status: "added", Slug: "rabbitmq"}); err != nil {
		t.Fatalf("AnswerRequest(): %v", err)
	}
	for _, voter := range []uuid.UUID{alice, bob} {
		notes, err := store.Notifications(ctx, voter)
		if err != nil || len(notes) == 0 || notes[0].Read || notes[0].Kind != "catalog_request" {
			t.Fatalf("notifications of %s = (%+v, %v)", voter, notes, err)
		}
		mine, err := store.MyRequests(ctx, voter)
		if err != nil || len(mine) != 1 || mine[0].Status != "added" || mine[0].ResolvedSlug == nil || *mine[0].ResolvedSlug != "rabbitmq" {
			t.Fatalf("my requests of %s = (%+v, %v)", voter, mine, err)
		}
	}
	// A mention in the same inbox, which reading the catalog answers must not clear.
	if _, err := db.ExecContext(ctx, `INSERT INTO notifications (user_id, kind, title) VALUES ($1, 'comment_mention', 'Someone mentioned you')`, alice); err != nil {
		t.Fatalf("insert a mention notification: %v", err)
	}
	if err := store.MarkNotificationsRead(ctx, alice, "catalog_request"); err != nil {
		t.Fatalf("MarkNotificationsRead(): %v", err)
	}
	var unreadMentions int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND kind = 'comment_mention' AND read_at IS NULL`, alice).Scan(&unreadMentions); err != nil || unreadMentions != 1 {
		t.Fatalf("unread mentions after reading catalog answers = %d, %v, want 1", unreadMentions, err)
	}
	if err := store.MarkNotificationsRead(ctx, alice, ""); err != nil {
		t.Fatalf("MarkNotificationsRead(all): %v", err)
	}
	if notes, _ := store.Notifications(ctx, alice); notes[0].Read != true {
		t.Fatalf("after reading: %+v", notes)
	}
	if err := store.AnswerRequest(ctx, admin, first.ID, appcatalog.Answer{Status: "added", Slug: "not-a-slug"}); err == nil {
		t.Fatal("added with a slug that is not in the catalog succeeded")
	}
}
