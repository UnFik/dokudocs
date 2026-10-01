//go:build integration

package ownergrants

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// fixture is a workspace whose documents exercise every ownership shape the
// 2026-09-29 dev audit and the cutover rules distinguish.
type fixture struct {
	db           *sql.DB
	workspaceID  uuid.UUID
	author       uuid.UUID // workspace member, authors most documents
	collaborator uuid.UUID
	departed     uuid.UUID // authored a document, then left the workspace

	healthy     uuid.UUID // owner grant on the author
	noGrants    uuid.UUID // no grant at all
	editOnly    uuid.UUID // author holds only an edit grant; collaborator has comment
	trashed     uuid.UUID // no owner, in Trash
	twoOwners   uuid.UUID // two owner grants
	authorLeft  uuid.UUID // no owner and the author is no longer a member
	transferred uuid.UUID // single owner who is not the author
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	f := &fixture{db: db, workspaceID: uuid.New()}
	f.author, f.collaborator, f.departed = newUser(t, db), newUser(t, db), newUser(t, db)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = db.ExecContext(ctx, `DELETE FROM workspaces WHERE id = $1`, f.workspaceID)
		for _, id := range []uuid.UUID{f.author, f.collaborator, f.departed} {
			_, _ = db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
		}
		_ = db.Close()
	})
	exec(t, db, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Owner grants test', $2, $3)`,
		f.workspaceID, "owner-grants-"+f.workspaceID.String(), f.author)
	exec(t, db, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
		f.workspaceID, f.author, f.collaborator)

	f.healthy = f.document(t, f.author, false)
	f.grant(t, f.healthy, f.author, "owner")

	f.noGrants = f.document(t, f.author, false)

	f.editOnly = f.document(t, f.author, false)
	f.grant(t, f.editOnly, f.author, "edit")
	f.grant(t, f.editOnly, f.collaborator, "comment")

	f.trashed = f.document(t, f.author, true)

	f.twoOwners = f.document(t, f.author, false)
	f.grant(t, f.twoOwners, f.author, "owner")
	f.grant(t, f.twoOwners, f.collaborator, "owner")

	f.authorLeft = f.document(t, f.departed, false) // departed never joined the workspace

	f.transferred = f.document(t, f.author, false)
	f.grant(t, f.transferred, f.collaborator, "owner")
	return f
}

func newUser(t *testing.T, db *sql.DB) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := db.QueryRowContext(context.Background(),
		`INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Owner grants test') RETURNING id`,
		uuid.NewString(), fmt.Sprintf("owner-grants-%s@example.invalid", uuid.NewString())).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return id
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func (f *fixture) document(t *testing.T, author uuid.UUID, trashed bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, f.db, `INSERT INTO documents (id, workspace_id, title, type, author_id, deleted_at)
		VALUES ($1, $2, $3, 'markdown', $4, CASE WHEN $5 THEN NOW() END)`, id, f.workspaceID, "doc "+id.String(), author, trashed)
	return id
}

func (f *fixture) grant(t *testing.T, documentID, userID uuid.UUID, level string) {
	t.Helper()
	exec(t, f.db, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, $3::document_access_level)`,
		documentID, userID, level)
}

func (f *fixture) grants(t *testing.T, documentID uuid.UUID) map[uuid.UUID]string {
	t.Helper()
	rows, err := f.db.QueryContext(context.Background(),
		`SELECT user_id, access_level::text FROM document_accesses WHERE document_id = $1`, documentID)
	if err != nil {
		t.Fatalf("read grants: %v", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]string{}
	for rows.Next() {
		var user uuid.UUID
		var level string
		if err := rows.Scan(&user, &level); err != nil {
			t.Fatal(err)
		}
		out[user] = level
	}
	return out
}

func (f *fixture) queryer() database.DB { return database.NewSQLDB(f.db) }

func findingFor(findings []Finding, documentID uuid.UUID) (Finding, bool) {
	for _, finding := range findings {
		if finding.DocumentID == documentID {
			return finding, true
		}
	}
	return Finding{}, false
}

func TestAuditClassifiesEveryOwnershipShape(t *testing.T) {
	f := newFixture(t)

	report, err := Audit(context.Background(), f.queryer(), Scope{WorkspaceIDs: []uuid.UUID{f.workspaceID}})
	if err != nil {
		t.Fatalf("Audit(): %v", err)
	}

	if report.Documents != 7 || report.Trashed != 1 {
		t.Fatalf("documents = %d, trashed = %d; want 7 and 1", report.Documents, report.Trashed)
	}
	for name, want := range map[string]struct {
		id         uuid.UUID
		resolution Resolution
	}{
		"no grants":   {f.noGrants, GrantToAuthor},
		"edit only":   {f.editOnly, PromoteAuthor},
		"trashed":     {f.trashed, GrantToAuthor},
		"author left": {f.authorLeft, BlockedAuthorNotMember},
	} {
		got, ok := findingFor(report.WithoutOwner, want.id)
		if !ok || got.Resolution != want.resolution {
			t.Fatalf("%s: finding = %+v ok=%v, want resolution %q", name, got, ok, want.resolution)
		}
	}
	if len(report.WithoutOwner) != 4 {
		t.Fatalf("documents without owner = %d, want 4 (healthy, two-owner, transferred must not appear)", len(report.WithoutOwner))
	}
	if _, ok := findingFor(report.MultipleOwners, f.twoOwners); !ok || len(report.MultipleOwners) != 1 {
		t.Fatalf("multiple owners = %+v, want only the two-owner document", report.MultipleOwners)
	}
	if report.OwnerIsNotAuthor != 2 {
		t.Fatalf("owner is not the author = %d, want 2 (transferred, and the second owner of the two-owner document)", report.OwnerIsNotAuthor)
	}
}

func (f *fixture) snapshot(t *testing.T) map[uuid.UUID]map[uuid.UUID]string {
	t.Helper()
	out := map[uuid.UUID]map[uuid.UUID]string{}
	for _, id := range []uuid.UUID{f.healthy, f.noGrants, f.editOnly, f.trashed, f.twoOwners, f.authorLeft, f.transferred} {
		out[id] = f.grants(t, id)
	}
	return out
}

func sameSnapshot(a, b map[uuid.UUID]map[uuid.UUID]string) bool {
	if len(a) != len(b) {
		return false
	}
	for id, grants := range a {
		if len(grants) != len(b[id]) {
			return false
		}
		for user, level := range grants {
			if b[id][user] != level {
				return false
			}
		}
	}
	return true
}

func TestReconcileWithoutApplyReportsTheRepairsAndChangesNothing(t *testing.T) {
	f := newFixture(t)
	before := f.snapshot(t)

	result, err := Reconcile(context.Background(), f.queryer(), Scope{WorkspaceIDs: []uuid.UUID{f.workspaceID}}, false)
	if err != nil {
		t.Fatalf("Reconcile(): %v", err)
	}

	if result.Applied || result.Fixed != 0 {
		t.Fatalf("result = %+v, want a dry run that fixed nothing", result)
	}
	if result.Before.Fixable() != 3 || result.Before.Blocked() != 1 {
		t.Fatalf("before: fixable = %d, blocked = %d; want 3 and 1", result.Before.Fixable(), result.Before.Blocked())
	}
	if !sameSnapshot(before, f.snapshot(t)) {
		t.Fatal("a dry run changed document_accesses")
	}
}

func TestReconcileApplyFixesOnlyWhatIsSafeAndKeepsOtherGrants(t *testing.T) {
	f := newFixture(t)
	scope := Scope{WorkspaceIDs: []uuid.UUID{f.workspaceID}}
	before := f.snapshot(t)

	result, err := Reconcile(context.Background(), f.queryer(), scope, true)
	if err != nil {
		t.Fatalf("Reconcile(apply): %v", err)
	}

	if !result.Applied || result.Fixed != 3 {
		t.Fatalf("result = %+v, want 3 documents fixed", result)
	}
	for name, id := range map[string]uuid.UUID{"no grants": f.noGrants, "edit only": f.editOnly, "trashed": f.trashed} {
		if got := f.grants(t, id)[f.author]; got != "owner" {
			t.Fatalf("%s: author grant = %q, want owner", name, got)
		}
	}
	if got := f.grants(t, f.editOnly)[f.collaborator]; got != "comment" {
		t.Fatalf("edit only: collaborator grant = %q, want the existing comment grant kept", got)
	}
	for name, id := range map[string]uuid.UUID{"healthy": f.healthy, "two owners": f.twoOwners, "author left": f.authorLeft, "transferred": f.transferred} {
		if !sameSnapshot(map[uuid.UUID]map[uuid.UUID]string{id: before[id]}, map[uuid.UUID]map[uuid.UUID]string{id: f.grants(t, id)}) {
			t.Fatalf("%s: grants changed, want it untouched", name)
		}
	}

	after, err := Audit(context.Background(), f.queryer(), scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.WithoutOwner) != 1 || after.WithoutOwner[0].DocumentID != f.authorLeft || len(after.MultipleOwners) != 1 {
		t.Fatalf("after apply: without owner = %+v, multiple = %+v; want only the author-left and two-owner documents to remain", after.WithoutOwner, after.MultipleOwners)
	}

	again, err := Reconcile(context.Background(), f.queryer(), scope, true)
	if err != nil {
		t.Fatalf("second Reconcile(apply): %v", err)
	}
	if again.Fixed != 0 {
		t.Fatalf("second apply fixed %d documents, want 0 (idempotent)", again.Fixed)
	}
}
