//go:build integration

package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func TestACitationHidesADocumentTheUserCanNoLongerRead(t *testing.T) {
	client := newConversationClient(t)
	ctx := context.Background()
	author := client.otherUser()
	documentID, messageID, nodeID := uuid.New(), uuid.New(), uuid.New()
	if _, err := client.db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, title, type, author_id, visibility) VALUES ($1, $2, 'Salary bands', 'markdown', $3, 'workspace')`, documentID, client.workspaceID, author); err != nil {
		t.Fatalf("create document: %v", err)
	}
	conversation := client.create()
	if _, err := client.db.ExecContext(ctx, `INSERT INTO rag_messages (message_id, conversation_id, sequence_no, role, content) VALUES (gen_random_uuid(), $1, 1, 'user', 'What are the bands?')`, conversation.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := client.db.ExecContext(ctx, `INSERT INTO rag_messages (message_id, conversation_id, sequence_no, role, content) VALUES ($1, $2, 2, 'assistant', 'Band 3 starts at ...')`, messageID, conversation.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := client.db.ExecContext(ctx, `
		INSERT INTO rag_message_citations (message_id, document_id, node_id, body_version, source_fingerprint, quoted_text, breadcrumb, ordinal, document_title, project_name)
		VALUES ($1, $2, $3, 1, 'fp', 'Band 3 starts at 5000', 'Compensation', 0, 'Salary bands', 'People')
	`, messageID, documentID, nodeID); err != nil {
		t.Fatalf("insert citation: %v", err)
	}

	citation := func() model.RAGCitation {
		t.Helper()
		res := client.do(http.MethodGet, "/api/v1/rag/conversations/"+conversation.ID.String(), "")
		if res.Code != http.StatusOK {
			t.Fatalf("read chat = %d %s", res.Code, res.Body.String())
		}
		var envelope struct {
			Data struct {
				Messages []model.RAGMessage `json:"messages"`
			} `json:"data"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		for _, message := range envelope.Data.Messages {
			if len(message.Citations) > 0 {
				return message.Citations[0]
			}
		}
		t.Fatalf("no citation in %s", res.Body.String())
		return model.RAGCitation{}
	}

	readable := citation()
	if readable.Unavailable || readable.DocumentTitle != "Salary bands" || readable.QuotedText != "Band 3 starts at 5000" {
		t.Fatalf("readable citation = %+v, want it shown in full", readable)
	}

	if _, err := client.db.ExecContext(ctx, `UPDATE documents SET visibility = 'private' WHERE id = $1`, documentID); err != nil {
		t.Fatal(err)
	}
	hidden := citation()
	if !hidden.Unavailable || hidden.DocumentTitle != "" || hidden.QuotedText != "" || hidden.Breadcrumb != "" || hidden.ProjectName != "" {
		t.Fatalf("citation after losing access = %+v, want it unavailable with no title, quote, breadcrumb or project", hidden)
	}
	if hidden.DocumentID != documentID {
		t.Fatalf("the citation keeps its place in the answer: %+v", hidden)
	}
}
