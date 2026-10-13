//go:build integration

package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (c *conversationClient) insertDocument(workspaceID, authorID uuid.UUID, title, visibility string) uuid.UUID {
	c.t.Helper()
	id := uuid.New()
	if _, err := c.db.ExecContext(context.Background(), `
		INSERT INTO documents (id, workspace_id, author_id, title, type, visibility) VALUES ($1, $2, $3, $4, 'markdown', $5)
	`, id, workspaceID, authorID, title, visibility); err != nil {
		c.t.Fatalf("insert document %q: %v", title, err)
	}
	return id
}

func (c *conversationClient) lookup(ids ...uuid.UUID) (*httpResult, []model.RAGDocumentHit) {
	c.t.Helper()
	list := make([]string, len(ids))
	for i, id := range ids {
		list[i] = fmt.Sprintf("%q", id.String())
	}
	res := c.do(http.MethodPost, "/api/v1/rag/documents/lookup", `{"ids":[`+strings.Join(list, ",")+`]}`)
	result := &httpResult{Code: res.Code, Body: res.Body.String()}
	if res.Code != http.StatusOK {
		return result, nil
	}
	var envelope ragChatEnvelope
	var hits []model.RAGDocumentHit
	if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil || json.Unmarshal(envelope.Data, &hits) != nil {
		c.t.Fatalf("decode lookup: %s", res.Body.String())
	}
	return result, hits
}

type httpResult struct {
	Code int
	Body string
}

func TestDocumentLookupReturnsOnlyWhatTheMemberMayRead(t *testing.T) {
	client := newConversationClient(t)
	ctx := context.Background()

	colleague := uuid.New()
	if _, err := client.db.ExecContext(ctx, `INSERT INTO users (id, account_no, email, full_name) VALUES ($1, $2, $3, 'Colleague')`,
		colleague, uuid.NewString(), fmt.Sprintf("colleague-%s@example.invalid", colleague)); err != nil {
		t.Fatalf("create colleague: %v", err)
	}
	if _, err := client.db.ExecContext(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, client.workspaceID, colleague); err != nil {
		t.Fatalf("add colleague: %v", err)
	}
	otherWorkspace := uuid.New()
	if _, err := client.db.ExecContext(ctx, `INSERT INTO workspaces (id, name, slug, created_by) VALUES ($1, 'Elsewhere', $2, $3)`, otherWorkspace, "else-"+otherWorkspace.String(), colleague); err != nil {
		t.Fatalf("create other workspace: %v", err)
	}
	t.Cleanup(func() {
		_, _ = client.db.ExecContext(context.Background(), `DELETE FROM workspaces WHERE id = $1`, otherWorkspace)
		_, _ = client.db.ExecContext(context.Background(), `DELETE FROM workspace_members WHERE user_id = $1`, colleague)
		_, _ = client.db.ExecContext(context.Background(), `DELETE FROM documents WHERE author_id = $1`, colleague)
		_, _ = client.db.ExecContext(context.Background(), `DELETE FROM users WHERE id = $1`, colleague)
	})

	own := client.insertDocument(client.workspaceID, client.userID, "Runbook", "private")
	shared := client.insertDocument(client.workspaceID, colleague, "Handbook", "workspace")
	hidden := client.insertDocument(client.workspaceID, colleague, "Salaries", "private")
	foreign := client.insertDocument(otherWorkspace, colleague, "Other team", "workspace")
	trashed := client.insertDocument(client.workspaceID, client.userID, "Old", "private")
	if _, err := client.db.ExecContext(ctx, `UPDATE documents SET deleted_at = now() WHERE id = $1`, trashed); err != nil {
		t.Fatalf("trash: %v", err)
	}

	res, hits := client.lookup(own, shared, hidden, foreign, trashed, uuid.New())
	if res.Code != http.StatusOK {
		t.Fatalf("lookup = %d, body = %s", res.Code, res.Body)
	}
	titles := map[uuid.UUID]string{}
	for _, hit := range hits {
		titles[hit.ID] = hit.Title
	}
	if len(titles) != 2 || titles[own] != "Runbook" || titles[shared] != "Handbook" {
		t.Fatalf("lookup titles = %v, want only the member's own and the shared document", titles)
	}
	for _, hit := range hits {
		if hit.Type != "markdown" {
			t.Fatalf("hit = %+v, want its type", hit)
		}
	}
}

func TestDocumentLookupTakesAtMostTwentyIDs(t *testing.T) {
	client := newConversationClient(t)
	ids := make([]uuid.UUID, 21)
	for i := range ids {
		ids[i] = uuid.New()
	}
	if res, _ := client.lookup(ids...); res.Code != http.StatusBadRequest {
		t.Fatalf("21 ids = %d, want 400", res.Code)
	}
	if res, hits := client.lookup(); res.Code != http.StatusOK || len(hits) != 0 {
		t.Fatalf("no ids = %d %v, want an empty list", res.Code, hits)
	}
	bad := client.do(http.MethodPost, "/api/v1/rag/documents/lookup", `{"ids":["nope"]}`)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("bad id = %d, want 400", bad.Code)
	}
}
