//go:build integration

package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// spend records model use by userID in this client's workspace.
func (c *conversationClient) spend(userID uuid.UUID, purpose string, tokens int, at time.Time) {
	c.t.Helper()
	if _, err := c.db.ExecContext(context.Background(), `
		INSERT INTO ai_model_usage (at, provider, model, purpose, feature, input_tokens, output_tokens, user_id, workspace_id, ok)
		VALUES ($1, 'openai', 'test-model', $2, 'chat_workspace', $3, 0, $4, $5, true)
	`, at, purpose, tokens, userID, c.workspaceID); err != nil {
		c.t.Fatalf("record usage: %v", err)
	}
}

// otherUser creates a second User who is a Member of the same workspace.
func (c *conversationClient) otherUser() uuid.UUID {
	c.t.Helper()
	id := uuid.New()
	ctx := context.Background()
	if _, err := c.db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'Other member')`, id, uuid.NewString(), "other-"+id.String()+"@example.invalid"); err != nil {
		c.t.Fatalf("create other user: %v", err)
	}
	if _, err := c.db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, c.workspaceID, id); err != nil {
		c.t.Fatalf("add other member: %v", err)
	}
	c.t.Cleanup(func() { _, _ = c.db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, id) })
	return id
}

type usageStatus struct {
	Used     int64     `json:"used"`
	Limit    int64     `json:"limit"`
	ResetsAt time.Time `json:"resetsAt"`
}

func (c *conversationClient) usage() usageStatus {
	c.t.Helper()
	res := c.do(http.MethodGet, "/api/v1/rag/usage", "")
	if res.Code != http.StatusOK {
		c.t.Fatalf("usage = %d, body = %s", res.Code, res.Body.String())
	}
	var envelope ragChatEnvelope
	var status usageStatus
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil || json.Unmarshal(envelope.Data, &status) != nil {
		c.t.Fatalf("decode usage: %s", res.Body.String())
	}
	return status
}

func TestUsageCountsThisMonthsAnswersOfThisUserInThisWorkspace(t *testing.T) {
	client := newConversationClient(t)
	now := time.Now().UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	client.spend(client.userID, "answer", 1200, now)
	client.spend(client.userID, "agent", 300, now)
	client.spend(client.userID, "embedding", 99999, now)
	client.spend(client.userID, "answer", 50000, monthStart.Add(-time.Hour))
	client.spend(client.otherUser(), "answer", 70000, now)

	got := client.usage()
	if got.Used != 1500 {
		t.Fatalf("used = %d, want 1500 (answers and agent this month; not embedding, last month or others)", got.Used)
	}
	if got.Limit != 300000 {
		t.Fatalf("limit = %d, want the Free plan's 300000", got.Limit)
	}
	if want := monthStart.AddDate(0, 1, 0); !got.ResetsAt.Equal(want) {
		t.Fatalf("resets at %s, want %s", got.ResetsAt, want)
	}
}

func TestAskIsRefusedOnceTheMonthlyLimitIsSpent(t *testing.T) {
	client := newConversationClient(t)
	conversation := client.create()
	client.spend(client.userID, "answer", 300000, time.Now().UTC())

	res := client.do(http.MethodPost, "/api/v1/rag/conversations/"+conversation.ID.String()+"/messages", `{"question":"Anything left?","language":"en"}`)
	if res.Code != http.StatusTooManyRequests {
		t.Fatalf("ask at the limit = %d, want 429 (body = %s)", res.Code, res.Body.String())
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil || body.Code != "ai_limit_reached" {
		t.Fatalf("error body = %s, want code ai_limit_reached", res.Body.String())
	}

	// Reading and managing history still works.
	if res := client.do(http.MethodGet, "/api/v1/rag/conversations/"+conversation.ID.String(), ""); res.Code != http.StatusOK {
		t.Fatalf("read history at the limit = %d", res.Code)
	}
	if res := client.do(http.MethodPatch, "/api/v1/rag/conversations/"+conversation.ID.String(), `{"title":"Still renamable"}`); res.Code != http.StatusOK {
		t.Fatalf("rename at the limit = %d", res.Code)
	}
}
