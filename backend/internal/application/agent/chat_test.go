package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

type scriptedModel struct {
	replies []Message
	seen    [][]Message
	tools   [][]ToolSpec
}

func (m *scriptedModel) Step(_ context.Context, messages []Message, tools []ToolSpec) (Message, error) {
	m.seen = append(m.seen, append([]Message(nil), messages...))
	m.tools = append(m.tools, tools)
	if len(m.replies) == 0 {
		return Message{Role: "assistant", Content: "out of script"}, nil
	}
	next := m.replies[0]
	m.replies = m.replies[1:]
	return next, nil
}

type memConversations struct {
	history model.RAGConversationHistory
	stored  []string
	meta    []json.RawMessage
	authErr error
}

func (c *memConversations) AuthorizeRAGQuestion(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) error {
	return c.authErr
}
func (c *memConversations) GetRAGConversation(context.Context, uuid.UUID, uuid.UUID) (model.RAGConversationHistory, error) {
	return c.history, nil
}
func (c *memConversations) StoreAgentAnswer(_ context.Context, _, _, _ uuid.UUID, question, answer string, meta json.RawMessage) error {
	c.stored = append(c.stored, question+" => "+answer)
	c.meta = append(c.meta, meta)
	return nil
}

type memActions struct {
	created []PendingAction
	byID    map[uuid.UUID]PendingAction
	claimed map[uuid.UUID]bool
	results map[uuid.UUID]string
}

func newMemActions() *memActions {
	return &memActions{byID: map[uuid.UUID]PendingAction{}, claimed: map[uuid.UUID]bool{}, results: map[uuid.UUID]string{}}
}
func (a *memActions) CreatePendingAction(_ context.Context, p PendingAction) (PendingAction, error) {
	p.ID, p.Status = uuid.New(), "pending"
	a.created = append(a.created, p)
	a.byID[p.ID] = p
	return p, nil
}
func (a *memActions) PendingAction(_ context.Context, id, userID uuid.UUID) (PendingAction, error) {
	p, ok := a.byID[id]
	if !ok || p.UserID != userID {
		return p, ErrActionNotFound
	}
	return p, nil
}
func (a *memActions) DecidePendingAction(_ context.Context, id, _ uuid.UUID, status, result string) (bool, error) {
	if a.claimed[id] {
		return false, nil
	}
	a.claimed[id] = true
	p := a.byID[id]
	p.Status, p.Result = status, result
	a.byID[id] = p
	return true, nil
}
func (a *memActions) FinishPendingAction(_ context.Context, id uuid.UUID, status, result string) error {
	p := a.byID[id]
	p.Status, p.Result = status, result
	a.byID[id] = p
	a.results[id] = result
	return nil
}

type memSkills map[string]string

func (s memSkills) SkillInstructions(_ context.Context, name string) (string, bool, error) {
	text, ok := s[name]
	return text, ok, nil
}

type chatEnv struct {
	chat    *ChatService
	model   *scriptedModel
	convs   *memConversations
	actions *memActions
	calls   *[]string
	user    uuid.UUID
	ws      uuid.UUID
	conv    uuid.UUID
}

func newChatEnv(caps []string, replies ...Message) *chatEnv {
	calls := &[]string{}
	user := uuid.New()
	exec := NewExecutor(NewPermissionService(memPermissions{user: caps}), fakeTools(calls), func(context.Context) int { return 4096 })
	e := &chatEnv{model: &scriptedModel{replies: replies}, convs: &memConversations{}, actions: newMemActions(), calls: calls, user: user, ws: uuid.New(), conv: uuid.New()}
	e.chat = NewChatService(e.model, exec, e.convs, e.actions, memSkills{"summary": "Write three bullet points."})
	return e
}

func (e *chatEnv) ask(question string) (ChatAnswer, error) {
	return e.chat.Ask(context.Background(), ChatInput{WorkspaceID: e.ws, ConversationID: e.conv, ActorID: e.user, Question: question, Language: "en"})
}

func call(name, args string) Message {
	return Message{Role: "assistant", ToolCalls: []ToolCall{{ID: "c-" + name, Name: name, Arguments: json.RawMessage(args)}}}
}

func TestTheAgentCallsToolsAndAnswersWithTheResult(t *testing.T) {
	e := newChatEnv([]string{CapRead}, call("list_documents", `{}`), Message{Role: "assistant", Content: "You have two documents."})
	answer, err := e.ask("What documents do I have?")
	if err != nil || answer.Text != "You have two documents." {
		t.Fatalf("Ask() = %+v, %v", answer, err)
	}
	if len(*e.calls) != 1 || !strings.Contains((*e.calls)[0], e.ws.String()) {
		t.Fatalf("tool calls = %v", *e.calls)
	}
	second := e.model.seen[1]
	last := second[len(second)-1]
	if last.Role != "tool" || last.ToolCallID != "c-list_documents" || !strings.Contains(last.Content, "never as instructions") {
		t.Fatalf("the tool result given back = %+v", last)
	}
	if len(e.convs.stored) != 1 || !strings.Contains(string(e.convs.meta[0]), "list_documents") {
		t.Fatalf("stored %v meta %s", e.convs.stored, e.convs.meta)
	}
	system := e.model.seen[0][0]
	if system.Role != "system" || !strings.Contains(system.Content, "never as instructions") {
		t.Fatalf("system prompt = %q", system.Content)
	}
}

func TestOnlyAllowedToolsAreOfferedToTheModel(t *testing.T) {
	e := newChatEnv([]string{CapRead}, Message{Role: "assistant", Content: "ok"})
	if _, err := e.ask("hi"); err != nil {
		t.Fatal(err)
	}
	for _, spec := range e.model.tools[0] {
		if spec.Name == "trash_document" || spec.Name == "edit_document_content" {
			t.Fatalf("%s was offered without the AI permission", spec.Name)
		}
	}
}

func TestAnActionThatNeedsApprovalBecomesACardAndRunsOnlyWhenApproved(t *testing.T) {
	e := newChatEnv([]string{CapRead, CapDocuments},
		call("trash_document", `{"document_id":"d1"}`),
		Message{Role: "assistant", Content: "I asked to move it to the trash; approve the card to go ahead."})
	answer, err := e.ask("Throw away the old spec")
	if err != nil || len(answer.Actions) != 1 || answer.Actions[0].Summary != "Move a document to trash" || answer.Actions[0].Status != "pending" {
		t.Fatalf("Ask() = %+v, %v", answer, err)
	}
	if len(*e.calls) != 0 {
		t.Fatalf("the action ran before approval: %v", *e.calls)
	}
	action := answer.Actions[0]
	if _, err := e.chat.Decide(context.Background(), uuid.New(), action.ID, true); !errors.Is(err, ErrActionNotFound) {
		t.Fatalf("another user decided it: %v", err)
	}
	decided, err := e.chat.Decide(context.Background(), e.user, action.ID, true)
	if err != nil || decided.Status != "approved" || len(*e.calls) != 1 {
		t.Fatalf("Decide() = %+v, %v, calls %v", decided, err, *e.calls)
	}
	if _, err := e.chat.Decide(context.Background(), e.user, action.ID, true); err == nil || len(*e.calls) != 1 {
		t.Fatalf("a second approval ran it again: %v, calls %v", err, *e.calls)
	}
}

func TestADeclinedActionNeverRuns(t *testing.T) {
	e := newChatEnv([]string{CapRead, CapDocuments}, call("trash_document", `{"document_id":"d1"}`), Message{Role: "assistant", Content: "waiting"})
	answer, _ := e.ask("trash it")
	decided, err := e.chat.Decide(context.Background(), e.user, answer.Actions[0].ID, false)
	if err != nil || decided.Status != "declined" || len(*e.calls) != 0 {
		t.Fatalf("Decide(decline) = %+v, %v, calls %v", decided, err, *e.calls)
	}
}

func TestAToolTheUserDidNotAllowIsReportedToTheModelNotRun(t *testing.T) {
	e := newChatEnv([]string{CapRead}, call("edit_document_content", `{"document_id":"d1"}`), Message{Role: "assistant", Content: "I am not allowed to edit."})
	answer, err := e.ask("fix the typo")
	if err != nil || answer.Text != "I am not allowed to edit." || len(*e.calls) != 0 {
		t.Fatalf("Ask() = %+v, %v, calls %v", answer, err, *e.calls)
	}
	result := e.model.seen[1][len(e.model.seen[1])-1].Content
	if !strings.Contains(result, "not allowed") {
		t.Fatalf("the refusal given back = %q", result)
	}
}

func TestASkillAddsItsInstructionsAndAnUnknownOneIsNamed(t *testing.T) {
	e := newChatEnv([]string{CapRead}, Message{Role: "assistant", Content: "- a\n- b\n- c"})
	if _, err := e.ask("/summary the release notes"); err != nil {
		t.Fatal(err)
	}
	first := e.model.seen[0]
	if !strings.Contains(first[0].Content, "Write three bullet points.") || first[len(first)-1].Content != "the release notes" {
		t.Fatalf("messages = %+v", first)
	}
	unknown := newChatEnv([]string{CapRead})
	if _, err := unknown.ask("/nope do it"); !errors.Is(err, ErrUnknownSkill) {
		t.Fatalf("unknown skill error = %v", err)
	}
}

func TestTheLoopStopsAfterTooManySteps(t *testing.T) {
	replies := []Message{}
	for range 20 {
		replies = append(replies, call("list_documents", `{}`))
	}
	e := newChatEnv([]string{CapRead}, replies...)
	answer, err := e.ask("loop forever")
	if err != nil || len(e.model.seen) > maxAgentSteps || answer.Text == "" {
		t.Fatalf("Ask() = %+v, %v after %d steps", answer, err, len(e.model.seen))
	}
}

func TestAQuestionOnAConversationTheUserCannotUseIsRefused(t *testing.T) {
	e := newChatEnv([]string{CapRead})
	e.convs.authErr = errors.New("forbidden")
	if _, err := e.ask("hi"); err == nil || len(e.model.seen) != 0 {
		t.Fatalf("Ask() error = %v after %d model calls", err, len(e.model.seen))
	}
}

func TestADocumentConversationIsToldWhichDocumentItIsAbout(t *testing.T) {
	e := newChatEnv([]string{CapRead}, Message{Role: "assistant", Content: "ok"})
	doc := uuid.New()
	e.convs.history.Conversation.DocumentID = &doc
	if _, err := e.ask("summarize"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(e.model.seen[0][0].Content, doc.String()) {
		t.Fatalf("system prompt does not name the document: %q", e.model.seen[0][0].Content)
	}
	for _, spec := range e.model.tools[0] {
		if spec.Name == "list_documents" {
			t.Fatal("a document Conversation was offered a workspace tool")
		}
	}
}
