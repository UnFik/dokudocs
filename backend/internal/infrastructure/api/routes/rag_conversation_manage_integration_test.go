//go:build integration

package routes

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	jwtmanager "backend/internal/application/jwt"
	"backend/internal/config"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"
	"backend/internal/infrastructure/logger"
	"backend/internal/infrastructure/runtime/container"
	"backend/internal/infrastructure/validator"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// conversationClient drives the Conversation routes as one signed-in Member.
type conversationClient struct {
	t           *testing.T
	db          *sql.DB
	userID      uuid.UUID
	api         http.Handler
	token       string
	workspaceID uuid.UUID
}

func newConversationClient(t *testing.T) *conversationClient {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TEST_DATABASE_URL is required for integration tests")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	ctx := context.Background()
	actorID, workspaceID := uuid.New(), uuid.New()
	email := fmt.Sprintf("conv-%s@example.invalid", actorID)
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'Conversation user')`, actorID, uuid.NewString(), email); err != nil {
		t.Fatalf("create user: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Conversations', $2, $3)`, workspaceID, "conv-"+workspaceID.String(), actorID); err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, workspaceID, actorID); err != nil {
		t.Fatalf("add member: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, workspaceID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, actorID)
		_ = db.Close()
	})
	app := container.New(database.NewSQLDB(db), logger.New(), validator.New())
	api := InitRoutes(app, config.Config{JWTSecret: "conv-test-secret", AccessTokenTTL: time.Hour})
	user, err := jwtmanager.NewManager("conv-test-secret", time.Hour).Issue(model.AuthUser{
		ID: actorID, AccountNo: "conv-account", Email: email, Roles: []string{"member"},
	})
	if err != nil {
		t.Fatalf("issue access token: %v", err)
	}
	return &conversationClient{t: t, db: db, userID: actorID, api: api, token: user.AccessToken, workspaceID: workspaceID}
}

func (c *conversationClient) do(method, path, body string) *httptest.ResponseRecorder {
	c.t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Workspace-Id", c.workspaceID.String())
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	c.api.ServeHTTP(recorder, req)
	return recorder
}

func (c *conversationClient) create() model.RAGConversation {
	c.t.Helper()
	res := c.do(http.MethodPost, "/api/v1/rag/conversations", "{}")
	if res.Code != http.StatusCreated {
		c.t.Fatalf("create conversation = %d, body = %s", res.Code, res.Body.String())
	}
	var envelope ragChatEnvelope
	var conversation model.RAGConversation
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil || json.Unmarshal(envelope.Data, &conversation) != nil {
		c.t.Fatalf("decode conversation: %s", res.Body.String())
	}
	return conversation
}

func (c *conversationClient) list() []model.RAGConversation {
	c.t.Helper()
	res := c.do(http.MethodGet, "/api/v1/rag/conversations", "")
	if res.Code != http.StatusOK {
		c.t.Fatalf("list conversations = %d, body = %s", res.Code, res.Body.String())
	}
	var envelope ragChatEnvelope
	var conversations []model.RAGConversation
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil || json.Unmarshal(envelope.Data, &conversations) != nil {
		c.t.Fatalf("decode conversations: %s", res.Body.String())
	}
	return conversations
}

func TestConversationRenamePinAndArchive(t *testing.T) {
	client := newConversationClient(t)
	first, second := client.create(), client.create()

	rename := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+first.ID.String(), `{"title":"  Deploy checklist  "}`)
	if rename.Code != http.StatusOK {
		t.Fatalf("rename = %d, body = %s", rename.Code, rename.Body.String())
	}
	pin := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+first.ID.String(), `{"pinned":true}`)
	if pin.Code != http.StatusOK {
		t.Fatalf("pin = %d, body = %s", pin.Code, pin.Body.String())
	}

	listed := client.list()
	if len(listed) != 2 || listed[0].ID != first.ID || listed[0].Title != "Deploy checklist" || listed[0].PinnedAt == nil {
		t.Fatalf("list after pin = %+v, want the pinned, renamed conversation first", listed)
	}

	archive := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+second.ID.String(), `{"archived":true}`)
	if archive.Code != http.StatusOK {
		t.Fatalf("archive = %d, body = %s", archive.Code, archive.Body.String())
	}
	listed = client.list()
	if len(listed) != 2 || listed[1].ID != second.ID || listed[1].ArchivedAt == nil {
		t.Fatalf("list after archive = %+v, want the archived conversation kept, after the others", listed)
	}

	blank := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+first.ID.String(), `{"title":"   "}`)
	if blank.Code != http.StatusBadRequest {
		t.Fatalf("blank rename = %d, want 400", blank.Code)
	}
}

func TestConversationPinsAreCappedAtFivePerScope(t *testing.T) {
	client := newConversationClient(t)
	var pinned []model.RAGConversation
	for i := 0; i < 5; i++ {
		conversation := client.create()
		res := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+conversation.ID.String(), `{"pinned":true}`)
		if res.Code != http.StatusOK {
			t.Fatalf("pin %d = %d, body = %s", i+1, res.Code, res.Body.String())
		}
		pinned = append(pinned, conversation)
	}
	sixth := client.create()
	res := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+sixth.ID.String(), `{"pinned":true}`)
	if res.Code != http.StatusConflict {
		t.Fatalf("sixth pin = %d, want 409 (body = %s)", res.Code, res.Body.String())
	}

	// Pinning one that is already pinned is not a sixth pin.
	again := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+pinned[0].ID.String(), `{"pinned":true}`)
	if again.Code != http.StatusOK {
		t.Fatalf("re-pin = %d, want 200", again.Code)
	}

	// Unpinning frees a place.
	if res := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+pinned[1].ID.String(), `{"pinned":false}`); res.Code != http.StatusOK {
		t.Fatalf("unpin = %d", res.Code)
	}
	if res := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+sixth.ID.String(), `{"pinned":true}`); res.Code != http.StatusOK {
		t.Fatalf("pin after unpin = %d, body = %s", res.Code, res.Body.String())
	}
}

func (c *conversationClient) answer(conversationID uuid.UUID, sequence int) {
	c.t.Helper()
	role := "assistant"
	if sequence%2 == 1 {
		role = "user"
	}
	if _, err := c.db.ExecContext(context.Background(), `
		INSERT INTO rag_messages (conversation_id, sequence_no, role, content) VALUES ($1, $2, $3, 'text')
	`, conversationID, sequence, role); err != nil {
		c.t.Fatalf("insert %s message: %v", role, err)
	}
}

func TestConversationUnreadFollowsTheLatestAnswer(t *testing.T) {
	client := newConversationClient(t)
	conversation := client.create()
	if got := client.list()[0]; got.Unread {
		t.Fatalf("empty conversation = %+v, want read", got)
	}

	client.answer(conversation.ID, 1)
	client.answer(conversation.ID, 2)
	if got := client.list()[0]; !got.Unread {
		t.Fatalf("after an answer = %+v, want unread", got)
	}

	read := client.do(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/read", "")
	if read.Code != http.StatusNoContent {
		t.Fatalf("mark read = %d, body = %s", read.Code, read.Body.String())
	}
	if got := client.list()[0]; got.Unread {
		t.Fatalf("after reading = %+v, want read", got)
	}

	client.answer(conversation.ID, 3)
	client.answer(conversation.ID, 4)
	if got := client.list()[0]; !got.Unread {
		t.Fatalf("after a newer answer = %+v, want unread again", got)
	}
}
