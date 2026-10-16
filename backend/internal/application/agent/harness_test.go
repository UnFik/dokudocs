package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	appchat "backend/internal/application/rag/usecase"
	"backend/internal/domain/model"
)

func TestACutOffToolCallIsNeverRunWithEmptyArgumentsAndTheModelIsToldWhy(t *testing.T) {
	cut := Message{Role: "assistant", ToolCalls: []ToolCall{{ID: "c1", Name: "list_documents", Arguments: json.RawMessage(`{}`), Invalid: true}}}
	e := newChatEnv([]string{CapRead}, cut, Message{Role: "assistant", Content: "ok"})
	if _, err := e.ask("write a long document"); err != nil {
		t.Fatal(err)
	}
	if len(*e.calls) != 0 {
		t.Fatalf("a cut-off call ran: %v", *e.calls)
	}
	second := e.model.seen[1]
	last := second[len(second)-1]
	if last.Role != "tool" || !strings.Contains(last.Content, "cut off") || !strings.Contains(last.Content, "append_section") {
		t.Fatalf("the model was told %+v", last)
	}
}

func TestACutOffAnswerSaysSo(t *testing.T) {
	e := newChatEnv([]string{CapRead}, Message{Role: "assistant", Content: "part one", Truncated: true})
	answer, err := e.ask("write everything")
	if err != nil || !strings.HasPrefix(answer.Text, "part one") || !strings.Contains(answer.Text, "cut off") {
		t.Fatalf("Ask() = %+v, %v", answer, err)
	}
}

type budgetModel struct {
	budgets []int
	replies []Message
	errs    []error
}

func (m *budgetModel) Step(ctx context.Context, _ []Message, _ []ToolSpec) (Message, error) {
	m.budgets = append(m.budgets, OutputBudget(ctx))
	i := len(m.budgets) - 1
	if i < len(m.errs) && m.errs[i] != nil {
		return Message{}, m.errs[i]
	}
	return m.replies[min(i, len(m.replies)-1)], nil
}

func TestAToolCallCutOffByTheOutputLimitIsRetriedWithABiggerLimit(t *testing.T) {
	cut := Message{Role: "assistant", Truncated: true, ToolCalls: []ToolCall{{ID: "c1", Name: "list_documents", Arguments: json.RawMessage(`{}`), Invalid: true}}}
	whole := call("list_documents", `{}`)
	m := &budgetModel{replies: []Message{cut, whole}}
	c := &ChatService{model: m}
	reply, err := c.modelStep(context.Background(), nil, nil)
	if err != nil || hasInvalidCall(reply) || len(m.budgets) != 2 || m.budgets[1] <= m.budgets[0] {
		t.Fatalf("modelStep() = %+v, %v, budgets %v", reply, err, m.budgets)
	}
}

func TestAProviderFailureForAMomentIsTriedAgain(t *testing.T) {
	m := &budgetModel{errs: []error{fmt.Errorf("%w: down", appchat.ErrRAGProviderUnavailable), nil}, replies: []Message{{Role: "assistant", Content: "fine"}}}
	c := &ChatService{model: m}
	reply, err := c.modelStep(context.Background(), nil, nil)
	if err != nil || reply.Content != "fine" || len(m.budgets) != 2 {
		t.Fatalf("modelStep() = %+v, %v after %d tries", reply, err, len(m.budgets))
	}
}

func TestAskUserEndsTheRunWithTheQuestionAndItsOptions(t *testing.T) {
	e := newChatEnv([]string{CapRead}, call("ask_user", `{"question":"Which spec?","options":["Q3","Q4"]}`))
	answer, err := e.ask("update the spec")
	if err != nil || answer.Text != "Which spec?\n- Q3\n- Q4" || len(e.model.seen) != 1 {
		t.Fatalf("Ask() = %+v, %v after %d steps", answer, err, len(e.model.seen))
	}
}

func TestThePlanIsShownToTheModelOnEveryLaterStepAndWidensTheStepLimit(t *testing.T) {
	plan := call("plan_update", `{"items":[{"title":"Intro","status":"done"},{"title":"Body","status":"pending"}]}`)
	e := newChatEnv([]string{CapRead}, plan, Message{Role: "assistant", Content: "done"})
	if _, err := e.ask("write a report"); err != nil {
		t.Fatal(err)
	}
	second := e.model.seen[1]
	reminder := second[len(second)-1]
	if reminder.Role != "system" || !strings.Contains(reminder.Content, "[pending] Body") || !strings.Contains(reminder.Content, "[done] Intro") {
		t.Fatalf("the model was not shown its plan: %+v", reminder)
	}
	s := newRunState()
	s.plan = []PlanItem{{Title: "x", Status: "pending"}}
	if s.stepLimit() != maxWorkSteps {
		t.Fatalf("limit = %d", s.stepLimit())
	}
	if !strings.Contains(s.stoppedText(30), "continue") {
		t.Fatal("the stop message does not offer to continue")
	}
}

func TestTheSameCallOverAndOverStopsTheRun(t *testing.T) {
	replies := []Message{}
	for range 10 {
		replies = append(replies, call("list_documents", `{}`))
	}
	e := newChatEnv([]string{CapRead}, replies...)
	answer, err := e.ask("loop")
	if err != nil || len(*e.calls) != maxIdenticalCalls || !strings.Contains(answer.Text, "repeating") {
		t.Fatalf("Ask() = %+v, %v, ran %d times", answer, err, len(*e.calls))
	}
}

func TestOldLargeToolResultsAreReplacedByAStubButRecentOnesStay(t *testing.T) {
	big := strings.Repeat("x", staleResultBytes+10)
	messages := []Message{{Role: "system", Content: "s"}, {Role: "tool", Content: big}}
	for range recentMessages {
		messages = append(messages, Message{Role: "user", Content: "u"})
	}
	messages = append(messages, Message{Role: "tool", Content: big})
	out := compactMessages(messages)
	if strings.Contains(out[1].Content, "xxx") || !strings.Contains(out[len(out)-1].Content, "xxx") {
		t.Fatalf("compactMessages() kept %d / %d bytes", len(out[1].Content), len(out[len(out)-1].Content))
	}
	if len(messages[1].Content) != len(big) {
		t.Fatal("the original conversation was changed")
	}
}

func TestLongHistoryIsShortenedNotDropped(t *testing.T) {
	e := newChatEnv([]string{CapRead}, Message{Role: "assistant", Content: "ok"})
	for i := range historyMessages + 5 {
		e.convs.history.Messages = append(e.convs.history.Messages, model.RAGMessage{Role: "user", Content: fmt.Sprintf("message number %d", i)})
	}
	if _, err := e.ask("and now?"); err != nil {
		t.Fatal(err)
	}
	if system := e.model.seen[0][0].Content; !strings.Contains(system, "message number 0") {
		t.Fatalf("the earliest message is gone: %q", system)
	}
}

func TestReadDocumentWindowKeepsTheVersionAndSaysHowToReadOn(t *testing.T) {
	text := "# One\n" + strings.Repeat("word ", 100) + "\n# Two\nend\n"
	out := readOutput{Version: "v9"}
	out.window(text, 0, 200, false, true)
	if !out.Truncated || out.NextOffset == nil || len([]rune(out.Content)) > 200 || len(out.Outline) != 2 || out.Outline[1].Heading != "Two" {
		t.Fatalf("window() = %+v", out)
	}
	raw, _ := json.Marshal(out)
	if strings.Index(string(raw), `"version"`) > strings.Index(string(raw), `"content"`) {
		t.Fatalf("the version comes after the text: %s", raw)
	}
	rest := readOutput{}
	rest.window(text, *out.NextOffset, 100000, false, true)
	if rest.Truncated || !strings.HasSuffix(out.Content+rest.Content, "end\n") || out.Content+rest.Content != text {
		t.Fatalf("the parts do not add up to the document")
	}
	only := readOutput{}
	only.window(text, 0, 0, true, true)
	if only.Content != "" || len(only.Outline) != 2 {
		t.Fatalf("outline only = %+v", only)
	}
}

func TestACutOffResultTellsTheModelHowToAskForLess(t *testing.T) {
	text, truncated := envelope(strings.Repeat("a", 500), 100)
	if !truncated || !strings.Contains(text, "offset") {
		t.Fatalf("envelope() = %q", text)
	}
}
