//go:build integration

package workspace

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"backend/constant"

	"github.com/google/uuid"
)

type inviteWorld struct {
	ctx         context.Context
	tx          *sql.Tx
	repo        *Repository
	workspaceID uuid.UUID
	ownerID     uuid.UUID
	adminID     uuid.UUID
	memberID    uuid.UUID
	memberEmail string
}

func newInviteWorld(t *testing.T) inviteWorld {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	t.Cleanup(func() { tx.Rollback() })

	w := inviteWorld{ctx: ctx, tx: tx, workspaceID: uuid.New()}
	w.ownerID, _ = insertInviteUser(t, ctx, tx)
	w.adminID, _ = insertInviteUser(t, ctx, tx)
	w.memberID, w.memberEmail = insertInviteUser(t, ctx, tx)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Invite Test', $2, $3)`,
		w.workspaceID, "invite-test-"+w.workspaceID.String(), w.ownerID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'member')`,
		w.workspaceID, w.ownerID, w.adminID, w.memberID); err != nil {
		t.Fatalf("create members: %v", err)
	}
	w.repo = &Repository{db: tx, tx: fixtureDB{Queryer: tx}}
	return w
}

func insertInviteUser(t *testing.T, ctx context.Context, tx *sql.Tx) (uuid.UUID, string) {
	t.Helper()
	email := fmt.Sprintf("invite-%s@example.invalid", uuid.NewString())
	var id uuid.UUID
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Invite Test') RETURNING id`,
		uuid.NewString(), email).Scan(&id); err != nil {
		t.Fatalf("create user: %v", err)
	}
	return id, email
}

func (w inviteWorld) issue(t *testing.T, actor uuid.UUID, email, role, hash string, cooldown time.Duration) error {
	t.Helper()
	_, err := w.repo.Issue(w.ctx, w.workspaceID, actor, email, role, hash, time.Hour, cooldown)
	return err
}

func (w inviteWorld) pendingCount(t *testing.T, email string) int {
	t.Helper()
	var n int
	if err := w.tx.QueryRowContext(w.ctx, `
		SELECT count(*) FROM workspace_invites
		WHERE workspace_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
		w.workspaceID, email).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestInviteIsAcceptedOnceByTheInvitedEmail(t *testing.T) {
	w := newInviteWorld(t)
	inviteeID, inviteeEmail := insertInviteUser(t, w.ctx, w.tx)
	otherID, otherEmail := insertInviteUser(t, w.ctx, w.tx)

	if err := w.issue(t, w.ownerID, inviteeEmail, "member", "hash-1", time.Minute); err != nil {
		t.Fatalf("Issue: %v", err)
	}
	preview, err := w.repo.Preview(w.ctx, "hash-1")
	if err != nil || preview.WorkspaceName != "Invite Test" || preview.Role != "member" || preview.Email != inviteeEmail {
		t.Fatalf("Preview = %+v, %v", preview, err)
	}
	if _, err := w.repo.Accept(w.ctx, "hash-1", otherID, otherEmail); !errors.Is(err, constant.ErrInviteEmailMismatch) {
		t.Fatalf("Accept by another email = %v, want mismatch", err)
	}
	if w.pendingCount(t, inviteeEmail) != 1 {
		t.Fatal("a wrong email used the invitation up")
	}
	got, err := w.repo.Accept(w.ctx, "hash-1", inviteeID, inviteeEmail)
	if err != nil || got != w.workspaceID {
		t.Fatalf("Accept = %v, %v", got, err)
	}
	role, err := w.repo.GetUserRole(w.ctx, w.workspaceID, inviteeID)
	if err != nil || role != "member" {
		t.Fatalf("role after accept = %q, %v", role, err)
	}
	if _, err := w.repo.Accept(w.ctx, "hash-1", inviteeID, inviteeEmail); !errors.Is(err, constant.ErrInviteNotFound) {
		t.Fatalf("second Accept = %v, want not found", err)
	}
	if _, err := w.repo.Preview(w.ctx, "hash-1"); !errors.Is(err, constant.ErrInviteNotFound) {
		t.Fatalf("Preview after accept = %v, want not found", err)
	}
}

func TestInviteAgainReplacesTheLinkAfterTheCooldown(t *testing.T) {
	w := newInviteWorld(t)
	_, email := insertInviteUser(t, w.ctx, w.tx)

	if err := w.issue(t, w.ownerID, email, "member", "old", time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := w.issue(t, w.ownerID, email, "member", "new", time.Minute); !errors.Is(err, constant.ErrInviteTooSoon) {
		t.Fatalf("second Issue inside the cooldown = %v, want too soon", err)
	}
	if err := w.issue(t, w.ownerID, email, "admin", "new", 0); err != nil {
		t.Fatalf("Issue after the cooldown: %v", err)
	}
	if w.pendingCount(t, email) != 1 {
		t.Fatal("inviting twice left two pending invitations")
	}
	if _, err := w.repo.Preview(w.ctx, "old"); !errors.Is(err, constant.ErrInviteNotFound) {
		t.Fatalf("old link = %v, want dead", err)
	}
	if p, err := w.repo.Preview(w.ctx, "new"); err != nil || p.Role != "admin" {
		t.Fatalf("new link = %+v, %v", p, err)
	}
}

func TestInviteWhoMayInvite(t *testing.T) {
	w := newInviteWorld(t)
	_, email := insertInviteUser(t, w.ctx, w.tx)

	if err := w.issue(t, w.memberID, email, "member", "h", 0); !errors.Is(err, constant.ErrForbidden) {
		t.Errorf("member invites = %v, want forbidden", err)
	}
	if err := w.issue(t, uuid.New(), email, "member", "h", 0); !errors.Is(err, constant.ErrForbidden) {
		t.Errorf("stranger invites = %v, want forbidden", err)
	}
	if err := w.issue(t, w.adminID, email, "admin", "h", 0); !errors.Is(err, constant.ErrForbidden) {
		t.Errorf("admin invites an admin = %v, want forbidden", err)
	}
	if err := w.issue(t, w.ownerID, w.memberEmail, "member", "h", 0); !errors.Is(err, constant.ErrAlreadyMember) {
		t.Errorf("invite a member = %v, want already member", err)
	}
	if err := w.issue(t, w.adminID, email, "member", "h-ok", 0); err != nil {
		t.Errorf("admin invites a member: %v", err)
	}
	if _, err := w.repo.ListPending(w.ctx, w.workspaceID, w.memberID); !errors.Is(err, constant.ErrForbidden) {
		t.Errorf("member lists = %v, want forbidden", err)
	}
	if list, err := w.repo.ListPending(w.ctx, w.workspaceID, w.adminID); err != nil || len(list) != 1 {
		t.Errorf("admin lists = %v, %v", list, err)
	}
}

func TestRevokedAndExpiredInvitationsAreDead(t *testing.T) {
	w := newInviteWorld(t)
	inviteeID, email := insertInviteUser(t, w.ctx, w.tx)

	invite, err := w.repo.Issue(w.ctx, w.workspaceID, w.ownerID, email, "member", "h", time.Hour, 0)
	if err != nil {
		t.Fatal(err)
	}
	adminInvite, err := w.repo.Issue(w.ctx, w.workspaceID, w.ownerID, "boss-"+email, "admin", "h-admin", time.Hour, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := w.repo.Revoke(w.ctx, w.workspaceID, w.adminID, adminInvite.ID); !errors.Is(err, constant.ErrForbidden) {
		t.Errorf("admin revokes an admin invitation = %v, want forbidden", err)
	}
	if err := w.repo.Revoke(w.ctx, w.workspaceID, w.adminID, invite.ID); err != nil {
		t.Fatalf("Revoke: %v", err)
	}
	if _, err := w.repo.Accept(w.ctx, "h", inviteeID, email); !errors.Is(err, constant.ErrInviteNotFound) {
		t.Errorf("Accept revoked = %v, want not found", err)
	}
	if err := w.repo.Revoke(w.ctx, w.workspaceID, w.adminID, invite.ID); !errors.Is(err, constant.ErrInviteNotFound) {
		t.Errorf("Revoke twice = %v, want not found", err)
	}

	// A revoked address can be invited again.
	if err := w.issue(t, w.ownerID, email, "member", "h2", 0); err != nil {
		t.Fatalf("invite after revoke: %v", err)
	}
	if _, err := w.tx.ExecContext(w.ctx, `UPDATE workspace_invites SET expires_at = now() - interval '1 second' WHERE token_hash = 'h2'`); err != nil {
		t.Fatal(err)
	}
	if _, err := w.repo.Accept(w.ctx, "h2", inviteeID, email); !errors.Is(err, constant.ErrInviteNotFound) {
		t.Errorf("Accept expired = %v, want not found", err)
	}
	if list, _ := w.repo.ListPending(w.ctx, w.workspaceID, w.ownerID); len(list) != 1 {
		t.Errorf("pending list holds %d, want only the live admin invitation", len(list))
	}
	if err := w.issue(t, w.ownerID, email, "member", "h3", 0); err != nil {
		t.Fatalf("invite over an expired one: %v", err)
	}
	if w.pendingCount(t, email) != 1 {
		t.Error("the expired invitation was kept beside the new one")
	}
}

func TestInviteCapAndDiscard(t *testing.T) {
	w := newInviteWorld(t)
	if _, err := w.tx.ExecContext(w.ctx, `
		INSERT INTO workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
		SELECT $1, 'bulk-' || n || '@example.invalid', 'member', 'bulk-' || n, $2, now() + interval '1 day'
		FROM generate_series(1, $3::int) n`, w.workspaceID, w.ownerID, maxPendingInvites); err != nil {
		t.Fatal(err)
	}
	if err := w.issue(t, w.ownerID, "one-more@example.invalid", "member", "h", 0); !errors.Is(err, constant.ErrInviteLimit) {
		t.Fatalf("Issue past the cap = %v, want limit", err)
	}
	if err := w.repo.Discard(w.ctx, "bulk-1"); err != nil {
		t.Fatal(err)
	}
	if err := w.issue(t, w.ownerID, "one-more@example.invalid", "member", "h", 0); err != nil {
		t.Fatalf("Issue after a discard: %v", err)
	}
}

func TestAcceptKeepsTheRoleOfAnExistingMember(t *testing.T) {
	w := newInviteWorld(t)
	if _, err := w.tx.ExecContext(w.ctx, `
		INSERT INTO workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
		VALUES ($1, $2, 'admin', 'again', $3, now() + interval '1 day')`, w.workspaceID, w.memberEmail, w.ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.repo.Accept(w.ctx, "again", w.memberID, w.memberEmail); err != nil {
		t.Fatalf("Accept: %v", err)
	}
	if role, _ := w.repo.GetUserRole(w.ctx, w.workspaceID, w.memberID); role != "member" {
		t.Fatalf("role = %q, an invitation must not promote a current member", role)
	}
}

func TestReissueNeedsAPendingInvitationInThisWorkspace(t *testing.T) {
	w := newInviteWorld(t)
	_, email := insertInviteUser(t, w.ctx, w.tx)
	invite, err := w.repo.Issue(w.ctx, w.workspaceID, w.ownerID, email, "member", "first", time.Hour, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.repo.Reissue(w.ctx, w.workspaceID, w.memberID, invite.ID, "x", time.Hour, 0); !errors.Is(err, constant.ErrForbidden) {
		t.Errorf("member resends = %v, want forbidden", err)
	}
	if _, err := w.repo.Reissue(w.ctx, w.workspaceID, w.adminID, uuid.New(), "x", time.Hour, 0); !errors.Is(err, constant.ErrInviteNotFound) {
		t.Errorf("unknown id = %v, want not found", err)
	}
	if _, err := w.repo.Reissue(w.ctx, w.workspaceID, w.adminID, invite.ID, "second", time.Hour, time.Minute); !errors.Is(err, constant.ErrInviteTooSoon) {
		t.Errorf("resend inside the cooldown = %v, want too soon", err)
	}
	if _, err := w.repo.Reissue(w.ctx, w.workspaceID, w.adminID, invite.ID, "second", time.Hour, 0); err != nil {
		t.Fatalf("Reissue: %v", err)
	}
	if _, err := w.repo.Preview(w.ctx, "first"); !errors.Is(err, constant.ErrInviteNotFound) {
		t.Errorf("first link after resend = %v, want dead", err)
	}
}
