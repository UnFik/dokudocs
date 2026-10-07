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
	t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), `DELETE FROM catalog_requests WHERE name_key = $1`, key) })

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
	t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), `DELETE FROM catalog_requests WHERE name_key LIKE $1`, prefix+"%") })
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
