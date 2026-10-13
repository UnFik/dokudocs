//go:build integration

package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	appchat "backend/internal/application/rag/usecase"
	"backend/internal/infrastructure/database"
	documentrepo "backend/internal/infrastructure/repository/document"
	"backend/internal/infrastructure/runtime/container"

	"github.com/google/uuid"
)

// extrasModel records what the Agent's answer model was given and cites the
// first thing it was given: an attachment if there is one, else a source.
type extrasModel struct {
	mu     sync.Mutex
	inputs []appchat.ModelInput
}

func (m *extrasModel) Answer(_ context.Context, input appchat.ModelInput) (appchat.ModelOutput, error) {
	if strings.HasPrefix(input.Question, appchat.TitleRequest) {
		return appchat.ModelOutput{Text: "Chat title"}, nil
	}
	m.mu.Lock()
	m.inputs = append(m.inputs, input)
	m.mu.Unlock()
	if len(input.Attachments) > 0 {
		return appchat.ModelOutput{Text: "From your file: " + input.Attachments[0].Text, SourceIDs: []uuid.UUID{input.Attachments[0].ID}}, nil
	}
	if len(input.Sources) > 0 {
		return appchat.ModelOutput{Text: "From the documents", SourceIDs: []uuid.UUID{input.Sources[0].ChunkID}}, nil
	}
	return appchat.ModelOutput{}, nil
}

func (m *extrasModel) last() appchat.ModelInput {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.inputs[len(m.inputs)-1]
}

func newExtrasClient(t *testing.T) (*conversationClient, *extrasModel) {
	t.Helper()
	answerModel := &extrasModel{}
	return newConversationClient(t, func(c *container.Container) { c.RAGAnswerModel = answerModel }), answerModel
}

// document adds a readable, indexed Markdown document to the client's workspace.
func (c *conversationClient) document(title, text string, projectID *uuid.UUID) uuid.UUID {
	c.t.Helper()
	ctx := context.Background()
	id := uuid.New()
	if _, err := c.db.ExecContext(ctx, `INSERT INTO documents (id, workspace_id, project_id, title, type, author_id, visibility) VALUES ($1, $2, $3, $4, 'markdown', $5, 'workspace')`, id, c.workspaceID, projectID, title, c.userID); err != nil {
		c.t.Fatalf("create document: %v", err)
	}
	if _, err := c.db.ExecContext(ctx, `INSERT INTO document_accesses (document_id, user_id, access_level) VALUES ($1, $2, 'owner')`, id, c.userID); err != nil {
		c.t.Fatalf("grant access: %v", err)
	}
	if _, err := c.db.ExecContext(ctx, `UPDATE documents SET content_json = $2::jsonb WHERE id = $1`, id, ragJSON(ragBlock("paragraph", uuid.New(), "", text))); err != nil {
		c.t.Fatalf("set content: %v", err)
	}
	if _, err := documentrepo.NewRepository(database.NewSQLDB(c.db)).RebuildRAGIndex(ctx, id); err != nil {
		c.t.Fatalf("index document: %v", err)
	}
	return id
}

func (c *conversationClient) ask(conversationID uuid.UUID, body string) *httpReply {
	c.t.Helper()
	res := c.do(http.MethodPost, "/api/v1/rag/conversations/"+conversationID.String()+"/messages", body)
	return &httpReply{Code: res.Code, Body: res.Body.String()}
}

type httpReply struct {
	Code int
	Body string
}

func TestAQuestionCanBeNarrowedToACategory(t *testing.T) {
	client, model := newExtrasClient(t)
	ctx := context.Background()
	projectID, ops := uuid.New(), uuid.New()
	if _, err := client.db.ExecContext(ctx, `INSERT INTO projects (id, workspace_id, name, visibility, created_by) VALUES ($1, $2, 'Platform', 'workspace', $3)`, projectID, client.workspaceID, client.userID); err != nil {
		t.Fatalf("create project: %v", err)
	}
	if _, err := client.db.ExecContext(ctx, `INSERT INTO project_categories (id, project_id, name) VALUES ($1, $2, 'Ops')`, ops, projectID); err != nil {
		t.Fatalf("create category: %v", err)
	}
	inOps := client.document("Payments runbook", "Restart procedure for the payments service", &projectID)
	client.document("Billing runbook", "Restart procedure for the billing service", &projectID)
	if _, err := client.db.ExecContext(ctx, `INSERT INTO document_category_mappings (document_id, category_id) VALUES ($1, $2)`, inOps, ops); err != nil {
		t.Fatalf("map category: %v", err)
	}

	res := client.do(http.MethodGet, "/api/v1/rag/categories", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), `"name":"Ops"`) || !strings.Contains(res.Body.String(), `"projectName":"Platform"`) {
		t.Fatalf("list categories = %d %s", res.Code, res.Body.String())
	}

	conversation := client.create()
	reply := client.ask(conversation.ID, `{"question":"restart procedure","language":"en"}`)
	if reply.Code != http.StatusOK {
		t.Fatalf("ask = %d %s", reply.Code, reply.Body)
	}
	var all []string
	for _, source := range model.last().Sources {
		all = append(all, source.Text)
	}
	if got := strings.Join(all, " | "); !strings.Contains(got, "payments") || !strings.Contains(got, "billing") {
		t.Fatalf("without a category the model saw %q, want both runbooks", got)
	}

	reply = client.ask(conversation.ID, fmt.Sprintf(`{"question":"restart procedure","language":"en","categoryIds":["%s"]}`, ops))
	if reply.Code != http.StatusOK {
		t.Fatalf("ask in category = %d %s", reply.Code, reply.Body)
	}
	var narrowed []string
	for _, source := range model.last().Sources {
		narrowed = append(narrowed, source.Text)
	}
	if got := strings.Join(narrowed, " | "); !strings.Contains(got, "payments") || strings.Contains(got, "billing") {
		t.Fatalf("in the Ops category the model saw %q, want only the payments runbook", got)
	}

	unknown := client.ask(conversation.ID, fmt.Sprintf(`{"question":"restart","language":"en","categoryIds":["%s"]}`, uuid.New()))
	if unknown.Code != http.StatusBadRequest {
		t.Fatalf("unknown category = %d, want 400", unknown.Code)
	}
}

func TestAnotherChatCanBeContextForAQuestion(t *testing.T) {
	client, model := newExtrasClient(t)
	ctx := context.Background()
	earlier := client.create()
	for i, row := range []struct{ role, text string }{{"user", "What is the deploy window?"}, {"assistant", "Tuesdays at 10:00."}} {
		if _, err := client.db.ExecContext(ctx, `INSERT INTO rag_messages (conversation_id, sequence_no, role, content) VALUES ($1, $2, $3, $4)`, earlier.ID, i+1, row.role, row.text); err != nil {
			t.Fatal(err)
		}
	}
	client.document("Runbook", "Deploys follow the window", nil)
	current := client.create()

	reply := client.ask(current.ID, fmt.Sprintf(`{"question":"deploys window","language":"en","contextChatIds":["%s"]}`, earlier.ID))
	if reply.Code != http.StatusOK {
		t.Fatalf("ask with context = %d %s", reply.Code, reply.Body)
	}
	input := model.last()
	if len(input.Context) != 1 || len(input.Context[0].Messages) != 2 || input.Context[0].Messages[1].Content != "Tuesdays at 10:00." {
		t.Fatalf("model context = %+v, want the earlier chat's two messages", input.Context)
	}

	other := client.otherUser()
	foreign := uuid.New()
	if _, err := client.db.ExecContext(ctx, `INSERT INTO rag_conversations (conversation_id, workspace_id, creator_id) VALUES ($1, $2, $3)`, foreign, client.workspaceID, other); err != nil {
		t.Fatal(err)
	}
	if got := client.ask(current.ID, fmt.Sprintf(`{"question":"deploys","language":"en","contextChatIds":["%s"]}`, foreign)); got.Code != http.StatusBadRequest {
		t.Fatalf("someone else's chat as context = %d, want 400", got.Code)
	}
	three := fmt.Sprintf(`["%s","%s","%s"]`, earlier.ID, earlier.ID, current.ID)
	if got := client.ask(current.ID, `{"question":"deploys","language":"en","contextChatIds":`+three+`}`); got.Code != http.StatusBadRequest {
		t.Fatalf("three chats as context = %d, want 400", got.Code)
	}
}

func TestATextFileCanBeAttachedToOneQuestion(t *testing.T) {
	client, model := newExtrasClient(t)
	conversation := client.create()

	reply := client.ask(conversation.ID, `{"question":"What is the vault code?","language":"en","attachments":[{"name":"notes.txt","text":"The vault code is 314."}]}`)
	if reply.Code != http.StatusOK {
		t.Fatalf("ask with a file = %d %s", reply.Code, reply.Body)
	}
	input := model.last()
	if len(input.Attachments) != 1 || input.Attachments[0].Name != "notes.txt" || input.Attachments[0].Text != "The vault code is 314." {
		t.Fatalf("model attachments = %+v", input.Attachments)
	}
	var answer struct {
		Data struct {
			Text      string `json:"text"`
			Citations []any  `json:"citations"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(reply.Body), &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Data.Text != "From your file: The vault code is 314." || len(answer.Data.Citations) != 0 {
		t.Fatalf("answer = %+v, want one grounded in the file and no document citation", answer.Data)
	}

	history := client.do(http.MethodGet, "/api/v1/rag/conversations/"+conversation.ID.String(), "")
	if !strings.Contains(history.Body.String(), "notes.txt") {
		t.Fatalf("the saved question does not say what was attached: %s", history.Body.String())
	}

	six := strings.Repeat(`{"name":"a.txt","text":"x"},`, 6)
	for name, body := range map[string]string{
		"six files":  `{"question":"q","language":"en","attachments":[` + strings.TrimSuffix(six, ",") + `]}`,
		"no name":    `{"question":"q","language":"en","attachments":[{"name":"","text":"x"}]}`,
		"empty text": `{"question":"q","language":"en","attachments":[{"name":"a.txt","text":"  "}]}`,
		"too much":   `{"question":"q","language":"en","attachments":[{"name":"a.txt","text":"` + strings.Repeat("x", 200_001) + `"}]}`,
		"odd type":   `{"question":"q","language":"en","attachments":[{"name":"a.exe","text":"x"}]}`,
	} {
		if got := client.ask(conversation.ID, body); got.Code != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", name, got.Code)
		}
	}
}
