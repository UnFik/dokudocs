//go:build integration

package routes

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// documentConversation opens a Conversation on an indexed document of the client.
// The server relays the editor state without matching the document's type, so
// the Markdown helper document stands in for a DBML one, which has no RAG index.
func (c *conversationClient) documentConversation() (documentID, conversationID uuid.UUID) {
	c.t.Helper()
	documentID, conversationID = c.document("Schema", "Table users and the id column", nil), uuid.New()
	if _, err := c.db.ExecContext(context.Background(), `INSERT INTO rag_conversations (conversation_id, workspace_id, creator_id, document_id) VALUES ($1, $2, $3, $4)`, conversationID, c.workspaceID, c.userID, documentID); err != nil {
		c.t.Fatalf("create conversation: %v", err)
	}
	return documentID, conversationID
}

func editorBody(documentID uuid.UUID) string {
	return fmt.Sprintf(`{"question":"read the editor error","language":"en","editorContext":{"documentId":"%s","kind":"dbml","cursor":{"line":2,"column":3},"diagnostics":[{"line":2,"column":1,"endLine":2,"endColumn":5,"severity":"error","message":"Invalid column definition or missing type"}],"excerpt":{"fromLine":1,"toLine":3,"text":"Table t {\n  id\n}"}}}`, documentID)
}

func TestTheEditorsErrorsReachTheAnswerModelOfADocumentChat(t *testing.T) {
	client, model := newExtrasClient(t)
	documentID, conversationID := client.documentConversation()

	reply := client.ask(conversationID, editorBody(documentID))
	if reply.Code != http.StatusOK {
		t.Fatalf("ask with editor state = %d %s", reply.Code, reply.Body)
	}
	editor := model.last().Editor
	if editor == nil || editor.DocumentID != documentID || len(editor.Diagnostics) != 1 || !strings.Contains(editor.Diagnostics[0].Message, "missing type") {
		t.Fatalf("the model was given editor = %+v", editor)
	}

	if plain := client.ask(conversationID, `{"question":"hello","language":"en"}`); plain.Code != http.StatusOK || model.last().Editor != nil {
		t.Fatalf("a question without editor state = %d, editor %+v", plain.Code, model.last().Editor)
	}
}

func TestEditorStateForAnotherDocumentOrAWorkspaceChatIsRefused(t *testing.T) {
	client, _ := newExtrasClient(t)
	_, conversationID := client.documentConversation()
	if reply := client.ask(conversationID, editorBody(uuid.New())); reply.Code != http.StatusBadRequest {
		t.Fatalf("editor state of another document = %d %s, want 400", reply.Code, reply.Body)
	}
	if reply := client.ask(client.create().ID, editorBody(uuid.New())); reply.Code != http.StatusBadRequest {
		t.Fatalf("editor state on a workspace chat = %d %s, want 400", reply.Code, reply.Body)
	}
	if reply := client.ask(conversationID, `{"question":"x","language":"en","editorContext":{"documentId":"not-a-uuid","kind":"dbml"}}`); reply.Code != http.StatusBadRequest {
		t.Fatalf("a bad document id = %d, want 400", reply.Code)
	}
}
