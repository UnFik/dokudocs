//go:build integration

package aisettings

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	app "backend/internal/application/aisettings"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func openStore(t *testing.T) (*Store, *sql.DB) {
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
	clear := func() {
		_, _ = db.Exec(`DELETE FROM ai_provider_settings`)
		_, _ = db.Exec(`DELETE FROM ai_provider_setting_changes`)
	}
	clear()
	t.Cleanup(clear)
	return NewStore(database.NewSQLDB(db)), db
}

func newUser(t *testing.T, db *sql.DB, roles ...string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	if err := db.QueryRowContext(ctx, `INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'AI test') RETURNING id`,
		uuid.NewString(), fmt.Sprintf("ai-%s@example.invalid", uuid.NewString())).Scan(&id); err != nil {
		t.Fatalf("user: %v", err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id = $1`, id) })
	for _, slug := range roles {
		if _, err := db.ExecContext(ctx, `INSERT INTO roles (name, slug, is_system) VALUES ($1, $1, true) ON CONFLICT (slug) DO NOTHING`, slug); err != nil {
			t.Fatalf("role: %v", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE slug = $2`, id, slug); err != nil {
			t.Fatalf("assign: %v", err)
		}
	}
	return id
}

func TestOnlyTheSuperadminRoleCountsAndRevokingItTakesEffectAtOnce(t *testing.T) {
	store, db := openStore(t)
	ctx := context.Background()
	super, admin, plain := newUser(t, db, "superadmin"), newUser(t, db, "admin"), newUser(t, db)
	for who, want := range map[uuid.UUID]bool{super: true, admin: false, plain: false, uuid.New(): false} {
		if got, err := store.IsSuperadmin(ctx, who); err != nil || got != want {
			t.Errorf("IsSuperadmin(%s) = %v, %v; want %v", who, got, err, want)
		}
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM user_roles WHERE user_id = $1`, super); err != nil {
		t.Fatal(err)
	}
	if got, _ := store.IsSuperadmin(ctx, super); got {
		t.Fatal("a revoked superadmin still passes")
	}
}

func TestASettingRoundTripsAndPutReplacesItAndClearsTheError(t *testing.T) {
	store, db := openStore(t)
	ctx := context.Background()
	by := newUser(t, db)
	record := app.Record{Purpose: app.PurposeAnswer, BaseURL: "https://api.example.com/v1", Protocol: app.ProtocolChatCompletions,
		Model: "m-1", APIKeyCiphertext: []byte{1, 2, 3}, UpdatedBy: &by, UpdatedAt: time.Now()}
	if err := store.Put(ctx, record); err != nil {
		t.Fatalf("Put(): %v", err)
	}
	got, found, err := store.Get(ctx, app.PurposeAnswer)
	if err != nil || !found || got.Model != "m-1" || string(got.APIKeyCiphertext) != "\x01\x02\x03" || got.UpdatedBy == nil || *got.UpdatedBy != by {
		t.Fatalf("Get() = %+v, %v, %v", got, found, err)
	}
	if _, found, _ := store.Get(ctx, app.PurposeEmbedding); found {
		t.Fatal("a purpose that was never saved was found")
	}

	if err := store.RecordError(ctx, app.PurposeAnswer, "provider answered 401"); err != nil {
		t.Fatal(err)
	}
	got, _, _ = store.Get(ctx, app.PurposeAnswer)
	if got.LastError != "provider answered 401" || got.LastErrorAt == nil {
		t.Fatalf("after RecordError: %+v", got)
	}

	record.Model = "m-2"
	if err := store.Put(ctx, record); err != nil {
		t.Fatal(err)
	}
	got, _, _ = store.Get(ctx, app.PurposeAnswer)
	if got.Model != "m-2" || got.LastError != "" || got.LastErrorAt != nil {
		t.Fatalf("after replacing: %+v", got)
	}

	if err := store.ClearError(ctx, app.PurposeAnswer); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(ctx, app.PurposeAnswer); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := store.Get(ctx, app.PurposeAnswer); found {
		t.Fatal("Delete() left the row")
	}
}

func TestTheAuditTrailKeepsNewestFirstAndSurvivesTheUserLeaving(t *testing.T) {
	store, db := openStore(t)
	ctx := context.Background()
	who := newUser(t, db)
	first := app.Change{Purpose: app.PurposeAnswer, ChangedBy: who, Changes: map[string]app.FieldChange{"model": {From: "a", To: "b"}}}
	second := app.Change{Purpose: app.PurposeEmbedding, ChangedBy: who, Changes: map[string]app.FieldChange{"apiKey": {To: "replaced"}}}
	for _, c := range []app.Change{first, second} {
		if err := store.AddChange(ctx, c); err != nil {
			t.Fatalf("AddChange(): %v", err)
		}
		time.Sleep(2 * time.Millisecond)
	}
	list, err := store.ListChanges(ctx, 10)
	if err != nil || len(list) != 2 || list[0].Purpose != app.PurposeEmbedding || list[1].Changes["model"] != (app.FieldChange{From: "a", To: "b"}) {
		t.Fatalf("ListChanges() = %+v, %v", list, err)
	}
	if list[0].ChangedBy != who {
		t.Fatalf("ChangedBy = %v, want %v", list[0].ChangedBy, who)
	}
	if limited, _ := store.ListChanges(ctx, 1); len(limited) != 1 {
		t.Fatalf("limit ignored: %d entries", len(limited))
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, who); err != nil {
		t.Fatal(err)
	}
	if list, err = store.ListChanges(ctx, 10); err != nil || len(list) != 2 || list[0].ChangedBy != uuid.Nil {
		t.Fatalf("after the user left: %+v, %v", list, err)
	}
}
