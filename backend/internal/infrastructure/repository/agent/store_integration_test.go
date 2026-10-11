//go:build integration

package agent

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	app "backend/internal/application/agent"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func open(t *testing.T) (*Store, *sql.DB) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStore(database.NewSQLDB(db)), db
}

func user(t *testing.T, db *sql.DB) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.QueryRow(`INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, 'Agent test') RETURNING id`,
		uuid.NewString(), fmt.Sprintf("agent-%s@example.invalid", uuid.NewString())).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id = $1`, id) })
	return id
}

func conversation(t *testing.T, db *sql.DB, owner uuid.UUID) (workspace, conversationID, document uuid.UUID) {
	t.Helper()
	workspace = uuid.New()
	if _, err := db.Exec(`INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Agent', $2, $3)`, workspace, "agent-"+workspace.String(), owner); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM workspaces WHERE id = $1`, workspace) })
	if err := db.QueryRow(`INSERT INTO rag_conversations (workspace_id, creator_id) VALUES ($1, $2) RETURNING conversation_id`, workspace, owner).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	document = uuid.New()
	if _, err := db.Exec(`INSERT INTO documents (id, workspace_id, title, type, author_id) VALUES ($1, $2, 'Doc', 'markdown', $3)`, document, workspace, owner); err != nil {
		t.Fatal(err)
	}
	return workspace, conversationID, document
}

func TestAIPermissionsAreSavedPerUser(t *testing.T) {
	store, db := open(t)
	ctx := context.Background()
	who := user(t, db)
	if _, saved, err := store.AIPermissions(ctx, who); err != nil || saved {
		t.Fatalf("AIPermissions() before saving = %v, %v", saved, err)
	}
	if err := store.SetAIPermissions(ctx, who, []string{app.CapRead, app.CapContent}); err != nil {
		t.Fatal(err)
	}
	caps, saved, err := store.AIPermissions(ctx, who)
	if err != nil || !saved || len(caps) != 2 || caps[1] != app.CapContent {
		t.Fatalf("AIPermissions() = %v, %v, %v", caps, saved, err)
	}
	if err := store.SetAIPermissions(ctx, who, []string{}); err != nil {
		t.Fatal(err)
	}
	if caps, saved, _ := store.AIPermissions(ctx, who); !saved || len(caps) != 0 {
		t.Fatalf("an empty set read back as %v, saved %v", caps, saved)
	}
}

func TestAIAssistedSuggestionsAreRememberedPerDocument(t *testing.T) {
	store, db := open(t)
	ctx := context.Background()
	who := user(t, db)
	_, _, document := conversation(t, db, who)
	first, second := uuid.New(), uuid.New()
	if err := store.MarkAIAssisted(ctx, document, []uuid.UUID{first, second}, who, "chat"); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkAIAssisted(ctx, document, []uuid.UUID{first}, who, "mcp"); err != nil {
		t.Fatalf("marking again must not fail: %v", err)
	}
	ids, err := store.AIAssistedSuggestionIDs(ctx, document)
	if err != nil || len(ids) != 2 {
		t.Fatalf("AIAssistedSuggestionIDs() = %v, %v", ids, err)
	}
}

func TestAPendingActionIsDecidedOnceByItsUser(t *testing.T) {
	store, db := open(t)
	ctx := context.Background()
	who, other := user(t, db), user(t, db)
	_, conv, _ := conversation(t, db, who)
	action, err := store.CreatePendingAction(ctx, app.PendingAction{ConversationID: conv, UserID: who, Tool: "trash_document", Arguments: json.RawMessage(`{"document_id":"x"}`), Summary: "Move to trash"})
	if err != nil || action.ID == uuid.Nil || action.Status != "pending" {
		t.Fatalf("CreatePendingAction() = %+v, %v", action, err)
	}
	if _, err := store.PendingAction(ctx, action.ID, other); err == nil {
		t.Fatal("another user read the action")
	}
	got, err := store.PendingAction(ctx, action.ID, who)
	if err != nil || got.Tool != "trash_document" || string(got.Arguments) != `{"document_id": "x"}` {
		t.Fatalf("PendingAction() = %+v, %v", got, err)
	}
	if ok, err := store.DecidePendingAction(ctx, action.ID, who, "approved", "done"); err != nil || !ok {
		t.Fatalf("DecidePendingAction() = %v, %v", ok, err)
	}
	if ok, _ := store.DecidePendingAction(ctx, action.ID, who, "declined", ""); ok {
		t.Fatal("an action was decided twice")
	}
	list, err := store.PendingActions(ctx, conv, who)
	if err != nil || len(list) != 1 || list[0].Status != "approved" || list[0].Result != "done" {
		t.Fatalf("PendingActions() = %+v, %v", list, err)
	}
}
