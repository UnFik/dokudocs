//go:build integration

package workspace

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestMemberMutationsRecheckActorRoleInTransaction(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer db.Close()

	ctx := context.Background()
	fixture, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer fixture.Rollback()

	ownerID := insertWorkspaceAccessUser(t, ctx, fixture)
	adminID := insertWorkspaceAccessUser(t, ctx, fixture)
	memberID := insertWorkspaceAccessUser(t, ctx, fixture)
	targetID := insertWorkspaceAccessUser(t, ctx, fixture)
	workspaceID := uuid.New()
	_, err = fixture.ExecContext(ctx, `
		INSERT INTO workspaces (id, name, slug, created_by)
		VALUES ($1, 'Workspace Access Test', $2, $3)
	`, workspaceID, "workspace-access-"+workspaceID.String(), ownerID)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	_, err = fixture.ExecContext(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'member')
	`, workspaceID, ownerID, adminID, memberID)
	if err != nil {
		t.Fatalf("create workspace members: %v", err)
	}

	txDB := fixtureDB{Queryer: fixture}
	repo := &Repository{db: fixture, tx: txDB}
	if _, err := repo.GetByID(ctx, workspaceID, targetID); !errors.Is(err, constant.ErrWorkspaceNotFound) {
		t.Errorf("GetByID() for workspace nonmember = %v, want workspace not found", err)
	}
	if err := repo.AddMember(ctx, workspaceID, memberID, targetID, "guest"); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("AddMember() for member = %v, want forbidden", err)
	}
	if err := repo.AddMember(ctx, workspaceID, adminID, targetID, "guest"); err != nil {
		t.Fatalf("AddMember() for admin: %v", err)
	}
	if err := repo.RemoveMember(ctx, workspaceID, memberID, targetID); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("RemoveMember() for member = %v, want forbidden", err)
	}

	if _, err := fixture.ExecContext(ctx, `UPDATE workspace_members SET role = 'member' WHERE workspace_id = $1 AND user_id = $2`, workspaceID, adminID); err != nil {
		t.Fatalf("demote admin: %v", err)
	}
	if err := repo.AddMember(ctx, workspaceID, adminID, targetID, "guest"); !errors.Is(err, constant.ErrForbidden) {
		t.Fatalf("AddMember() after demotion = %v, want forbidden", err)
	}

	var targetRole string
	if err := fixture.QueryRowContext(ctx, `SELECT role::text FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, workspaceID, targetID).Scan(&targetRole); err != nil {
		t.Fatalf("read target role: %v", err)
	}
	if targetRole != "guest" {
		t.Fatalf("target role = %q, want guest", targetRole)
	}
	if err := repo.RemoveMember(ctx, workspaceID, ownerID, memberID); err != nil {
		t.Fatalf("revoke member access: %v", err)
	}
	members, err := repo.GetMembers(ctx, workspaceID, memberID)
	if err != nil || len(members) != 0 {
		t.Errorf("GetMembers() after access revoke = (%+v, %v), want no workspace roster", members, err)
	}
}

func insertWorkspaceAccessUser(t *testing.T, ctx context.Context, tx *sql.Tx) uuid.UUID {
	t.Helper()
	var userID uuid.UUID
	err := tx.QueryRowContext(ctx, `
		INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Workspace Access Test') RETURNING id
	`, uuid.NewString(), fmt.Sprintf("workspace-access-%s@example.invalid", uuid.NewString())).Scan(&userID)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return userID
}

type fixtureDB struct{ database.Queryer }

func (db fixtureDB) WithTransaction(_ context.Context, fn func(database.Queryer) error) error {
	return fn(db.Queryer)
}

func (fixtureDB) Raw() *sql.DB { return nil }

func (fixtureDB) Close() error { return nil }
