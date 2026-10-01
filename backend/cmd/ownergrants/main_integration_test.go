//go:build integration

package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type cliFixture struct {
	db          *sql.DB
	url         string
	workspaceID uuid.UUID
	authorID    uuid.UUID
	documentID  uuid.UUID
}

func newCLIFixture(t *testing.T) *cliFixture {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	f := &cliFixture{db: db, url: url, workspaceID: uuid.New(), documentID: uuid.New()}
	ctx := context.Background()
	if err := db.QueryRowContext(ctx, `INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'CLI test') RETURNING id`,
		uuid.NewString(), fmt.Sprintf("owner-cli-%s@example.invalid", uuid.NewString())).Scan(&f.authorID); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, f.workspaceID)
		_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, f.authorID)
		_ = db.Close()
	})
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'CLI test', $2, $3)`, []any{f.workspaceID, "owner-cli-" + f.workspaceID.String(), f.authorID}},
		{`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, []any{f.workspaceID, f.authorID}},
		{`INSERT INTO documents (id, workspace_id, title, type, author_id) VALUES ($1, $2, 'ownerless', 'markdown', $3)`, []any{f.documentID, f.workspaceID, f.authorID}},
	} {
		if _, err := db.ExecContext(ctx, q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	return f
}

func (f *cliFixture) owners(t *testing.T) int {
	t.Helper()
	var count int
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM document_accesses WHERE document_id = $1 AND access_level = 'owner'`, f.documentID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func (f *cliFixture) run(t *testing.T, args ...string) (map[string]any, error) {
	t.Helper()
	var out bytes.Buffer
	env := func(key string) string {
		if key == "DATABASE_URL" {
			return f.url
		}
		return ""
	}
	err := run(context.Background(), args, env, &out)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(out.Bytes(), &result); err != nil {
		t.Fatalf("output is not JSON: %v\n%s", err, out.String())
	}
	return result, nil
}

func TestOwnerGrantsCLIDefaultsToADryRun(t *testing.T) {
	f := newCLIFixture(t)

	result, err := f.run(t, "--workspace", f.workspaceID.String())
	if err != nil {
		t.Fatalf("run(): %v", err)
	}

	if result["applied"] != false {
		t.Fatalf("applied = %v, want false without --apply", result["applied"])
	}
	if f.owners(t) != 0 {
		t.Fatal("the default run granted ownership; it must be a dry run")
	}
	if before := result["before"].(map[string]any); len(before["withoutOwner"].([]any)) != 1 {
		t.Fatalf("report = %v, want the ownerless document listed", before)
	}
}

func TestOwnerGrantsCLIApplyGrantsOwnershipOnlyInTheRequestedWorkspace(t *testing.T) {
	f := newCLIFixture(t)

	if _, err := f.run(t, "--apply", "--workspace", uuid.NewString()); err != nil {
		t.Fatalf("run() for another workspace: %v", err)
	}
	if f.owners(t) != 0 {
		t.Fatal("--apply on another workspace changed this one")
	}

	result, err := f.run(t, "--apply", "--workspace", f.workspaceID.String())
	if err != nil {
		t.Fatalf("run(--apply): %v", err)
	}
	if result["applied"] != true || result["fixed"] != float64(1) || f.owners(t) != 1 {
		t.Fatalf("result = %v, owners = %d; want the author made owner", result, f.owners(t))
	}
}

func TestOwnerGrantsCLIRejectsBadInput(t *testing.T) {
	f := newCLIFixture(t)
	if _, err := f.run(t, "--workspace", "not-a-uuid"); err == nil {
		t.Fatal("run() accepted an invalid workspace ID")
	}
	if _, err := f.run(t, "--unknown"); err == nil {
		t.Fatal("run() accepted an unknown flag")
	}
	var out bytes.Buffer
	err := run(context.Background(), nil, func(string) string { return "" }, &out)
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("run() without DATABASE_URL = %v, want an error naming it", err)
	}
}
