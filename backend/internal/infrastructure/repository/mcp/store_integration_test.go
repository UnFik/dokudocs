//go:build integration

package mcp

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	app "backend/internal/application/mcp"
	"backend/internal/application/skills"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func open(t *testing.T) (*Store, *sql.DB, uuid.UUID) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var user uuid.UUID
	if err := db.QueryRow(`INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'MCP test') RETURNING id`,
		uuid.NewString(), fmt.Sprintf("mcp-%s@example.invalid", uuid.NewString())).Scan(&user); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id = $1`, user) })
	return NewStore(database.NewSQLDB(db)), db, user
}

func TestKeysSettingsAndAuditRoundTrip(t *testing.T) {
	store, db, user := open(t)
	ctx := context.Background()
	svc := app.NewService(store, store, store, fakeAdmins{})
	key, secret, err := svc.CreateKey(ctx, user, "Laptop", 7)
	if err != nil {
		t.Fatalf("CreateKey(): %v", err)
	}
	var stored string
	_ = db.QueryRow(`SELECT key_hash FROM mcp_api_keys WHERE id = $1`, key.ID).Scan(&stored)
	if stored == secret || stored == "" {
		t.Fatal("the secret itself is in the table")
	}
	got, err := svc.Authenticate(ctx, secret)
	if err != nil || got.ID != key.ID {
		t.Fatalf("Authenticate() = %+v, %v", got, err)
	}
	keys, _ := svc.ListKeys(ctx, user)
	if len(keys) != 1 || keys[0].LastUsedAt == nil {
		t.Fatalf("ListKeys() = %+v", keys)
	}
	if ok, err := svc.RevokeKey(ctx, user, key.ID); !ok || err != nil {
		t.Fatalf("RevokeKey() = %v, %v", ok, err)
	}
	if _, err := svc.Authenticate(ctx, secret); !errors.Is(err, app.ErrUnauthorized) {
		t.Fatalf("a revoked key authenticated: %v", err)
	}

	before, _ := store.MCPSettings(ctx)
	t.Cleanup(func() { _ = store.SaveMCPSettings(context.Background(), before, user) })
	next := app.Settings{Enabled: false, ReadPerMinute: 5, WritePerMinute: 2, MaxResultBytes: 4096, AuditRetentionDays: 7}
	if err := store.SaveMCPSettings(ctx, next, user); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.MCPSettings(ctx); got.Enabled || got.ReadPerMinute != 5 || got.AuditRetentionDays != 7 {
		t.Fatalf("MCPSettings() = %+v", got)
	}

	if err := store.AddAudit(ctx, app.AuditEntry{KeyID: key.ID, UserID: user, Tool: "read_document", Resource: "doc-1", Outcome: app.OutcomeOK}); err != nil {
		t.Fatal(err)
	}
	mine, err := store.ListAudit(ctx, &user, 10)
	if err != nil || len(mine) != 1 || mine[0].KeyName != "Laptop" || mine[0].UserName != "MCP test" {
		t.Fatalf("ListAudit() = %+v, %v", mine, err)
	}
	if n, err := store.PruneAudit(ctx, time.Now().Add(time.Minute)); err != nil || n < 1 {
		t.Fatalf("PruneAudit() = %d, %v", n, err)
	}
}

func TestSkillsAreUniqueByName(t *testing.T) {
	store, db, user := open(t)
	ctx := context.Background()
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM skills WHERE name LIKE 'it-%'`) })
	name := "it-" + uuid.NewString()[:8]
	saved, err := store.SaveSkill(ctx, skills.Skill{Name: name, Description: "d", Instructions: "Do it."}, user)
	if err != nil || saved.ID == uuid.Nil {
		t.Fatalf("SaveSkill() = %+v, %v", saved, err)
	}
	if _, err := store.SaveSkill(ctx, skills.Skill{Name: name, Instructions: "Again."}, user); !errors.Is(err, ErrSkillNameTaken) {
		t.Fatalf("a duplicate name was saved: %v", err)
	}
	saved.Instructions = "Do it well."
	if updated, err := store.SaveSkill(ctx, saved, user); err != nil || updated.Instructions != "Do it well." {
		t.Fatalf("update = %+v, %v", updated, err)
	}
	if got, ok, _ := store.SkillByName(ctx, name); !ok || got.ID != saved.ID {
		t.Fatalf("SkillByName() = %+v, %v", got, ok)
	}
	if ok, _ := store.DeleteSkill(ctx, saved.ID); !ok {
		t.Fatal("DeleteSkill() did nothing")
	}
}

type fakeAdmins struct{}

func (fakeAdmins) IsSuperadmin(context.Context, uuid.UUID) (bool, error) { return false, nil }
