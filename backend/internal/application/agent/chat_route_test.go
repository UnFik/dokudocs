package agent

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"backend/internal/application/airuns"

	"github.com/google/uuid"
)

type switches struct{ gate, router bool }

func (s switches) GateEnabled(context.Context) bool   { return s.gate }
func (s switches) RouterEnabled(context.Context) bool { return s.router }

// routeEnv is a chat whose requests are traced and routed.
type routeEnv struct {
	*chatEnv
	trace *memTrace
	small *scriptedModel
	class *fakeClassifier
}

func newRouteEnv(caps []string, large ...Message) *routeEnv {
	e := newChatEnv(caps, large...)
	r := &routeEnv{chatEnv: e, trace: &memTrace{}, small: &scriptedModel{}, class: &fakeClassifier{}}
	e.chat.WithRouting(NewGate(r.class), r.small, switches{gate: true, router: true})
	return r
}

func (r *routeEnv) ask(question string) (ChatAnswer, error) {
	ctx := WithTrace(airuns.WithRun(context.Background(), uuid.New()), r.trace)
	return r.chat.Ask(ctx, ChatInput{WorkspaceID: r.ws, ConversationID: r.conv, ActorID: r.user, Question: question, Language: "en"})
}

func (r *routeEnv) path() []string {
	out := make([]string, len(r.trace.steps))
	for i, s := range r.trace.steps {
		out[i] = s.Node
	}
	return out
}

func TestAClearlyOffTopicRequestIsTurnedAwayWithoutCallingAnyAgentModel(t *testing.T) {
	r := newRouteEnv([]string{CapRead})
	r.class.result = ClassifierResult{Label: LabelOutOfDomain, Confidence: 0.97}
	answer, err := r.ask("cuaca besok di Jakarta panas banget")
	if err != nil || answer.Text == "" || len(r.model.seen) != 0 || len(r.small.seen) != 0 {
		t.Fatalf("Ask() = %+v, %v; large %d small %d", answer, err, len(r.model.seen), len(r.small.seen))
	}
	if want := []string{NodeInput, NodeContext, NodeGate, NodeReject}; !slices.Equal(r.path(), want) {
		t.Fatalf("path = %v", r.path())
	}
	if len(r.convs.stored) != 1 {
		t.Fatalf("the refusal was not stored in the Conversation: %v", r.convs.stored)
	}
}

func TestARequestThatNamesNoDocumentGetsOneQuestionBackAndCostsNoAgentStep(t *testing.T) {
	r := newRouteEnv([]string{CapRead})
	answer, err := r.ask("Ringkas dokumen ini")
	if err != nil || !strings.Contains(answer.Text, "Which document") || len(r.model.seen)+len(r.small.seen) != 0 {
		t.Fatalf("Ask() = %+v, %v", answer, err)
	}
	if want := []string{NodeInput, NodeContext, NodeGate, NodeClarify}; !slices.Equal(r.path(), want) {
		t.Fatalf("path = %v", r.path())
	}
}

func TestASimpleQuestionIsAnsweredByTheSmallModelAndAnEditByTheMainOne(t *testing.T) {
	r := newRouteEnv([]string{CapRead}, Message{Role: "assistant", Content: "edited"})
	r.small.replies = []Message{{Role: "assistant", Content: "two documents"}}
	answer, err := r.ask("Berapa dokumen di project Alpha?")
	if err != nil || answer.Text != "two documents" || len(r.model.seen) != 0 || len(r.small.seen) != 1 {
		t.Fatalf("simple: %+v, %v; large %d small %d", answer, err, len(r.model.seen), len(r.small.seen))
	}
	if r.trace.steps[len(r.trace.steps)-2].Node != NodeModelSmall {
		t.Fatalf("path = %v", r.path())
	}
	r.trace.steps = nil
	answer, err = r.ask("Ubah judul dokumen deployment")
	if err != nil || answer.Text != "edited" || len(r.model.seen) != 1 || !slices.Contains(r.path(), NodeModelLarge) {
		t.Fatalf("edit: %+v, %v; path %v", answer, err, r.path())
	}
}

func TestWhenTheSmallModelIsNotSetEverythingGoesToTheMainModel(t *testing.T) {
	r := newRouteEnv([]string{CapRead}, Message{Role: "assistant", Content: "ok"})
	r.chat.WithRouting(NewGate(r.class), nil, switches{gate: true, router: true})
	if _, err := r.ask("Berapa dokumen di project Alpha?"); err != nil || len(r.model.seen) != 1 {
		t.Fatalf("Ask() error %v, large %d", err, len(r.model.seen))
	}
}

func TestWithTheSwitchesOffTheGateAndRouterStepAsideAndTheAgentWorksAsBefore(t *testing.T) {
	r := newRouteEnv([]string{CapRead}, Message{Role: "assistant", Content: "answer"})
	r.chat.WithRouting(NewGate(r.class), r.small, switches{})
	r.class.result = ClassifierResult{Label: LabelOutOfDomain, Confidence: 0.99}
	answer, err := r.ask("cuaca besok di Jakarta panas banget")
	if err != nil || answer.Text != "answer" || r.class.calls != 0 || len(r.small.seen) != 0 {
		t.Fatalf("Ask() = %+v, %v; classifier calls %d", answer, err, r.class.calls)
	}
	var gate Step
	for _, s := range r.trace.steps {
		if s.Node == NodeGate {
			gate = s
		}
	}
	if gate.Reason != "gate_off" {
		t.Fatalf("the skipped gate was not recorded: %+v", r.trace.steps)
	}
}

func TestAFailingClassifierLetsTheAgentHandleTheRequest(t *testing.T) {
	r := newRouteEnv([]string{CapRead}, Message{Role: "assistant", Content: "fine"})
	r.class.err = errors.New("small model down")
	answer, err := r.ask("yang tadi itu gimana ya")
	if err != nil || answer.Text != "fine" {
		t.Fatalf("Ask() = %+v, %v", answer, err)
	}
}

func TestTheTraceShowsEachToolCallAndTheLoopBackToTheModel(t *testing.T) {
	r := newRouteEnv([]string{CapRead}, call("list_documents", `{}`), Message{Role: "assistant", Content: "You have two."})
	r.chat.WithRouting(NewGate(r.class), r.small, switches{gate: true, router: true})
	if _, err := r.ask("Tulis daftar dokumen saya"); err != nil {
		t.Fatal(err)
	}
	want := []string{NodeInput, NodeContext, NodeGate, NodeRoute, NodeModelLarge, NodeTools, NodeModelLarge, NodeRespond}
	if !slices.Equal(r.path(), want) {
		t.Fatalf("path = %v", r.path())
	}
	tool := r.trace.steps[5]
	if tool.Tool != "list_documents" || tool.Status != StatusOK {
		t.Fatalf("tool step = %+v", tool)
	}
	if r.trace.steps[4].Edge != EdgeFull || r.trace.steps[6].Edge != EdgeToolResult {
		t.Fatalf("edges = %q, %q", r.trace.steps[4].Edge, r.trace.steps[6].Edge)
	}
}

func TestAnActionThatWaitsForTheUserEndsTheTraceAtApproval(t *testing.T) {
	r := newRouteEnv([]string{CapRead, CapDocuments}, call("trash_document", `{"document_id":"d1"}`), Message{Role: "assistant", Content: "asked"})
	if _, err := r.ask("Hapus dokumen lama"); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(r.path(), NodeApproval) {
		t.Fatalf("path = %v", r.path())
	}
	if last := r.trace.steps[len(r.trace.steps)-1]; last.Node != NodeRespond {
		t.Fatalf("last step = %+v", last)
	}
}

func TestTheTraceKeepsNoWordsOfTheUserOrTheTools(t *testing.T) {
	r := newRouteEnv([]string{CapRead}, call("list_documents", `{"query":"secret merger plan"}`), Message{Role: "assistant", Content: "the secret merger plan is at the top"})
	if _, err := r.ask("Tulis tentang secret merger plan"); err != nil {
		t.Fatal(err)
	}
	for _, s := range r.trace.steps {
		if strings.Contains(strings.ToLower(s.Reason+s.Tool+s.Model+s.Edge), "secret") {
			t.Fatalf("a step carries the User's words: %+v", s)
		}
	}
}

func TestARetryAndATruncationShowUpAsTheirOwnAttempts(t *testing.T) {
	cut := Message{Role: "assistant", Truncated: true, FinishReason: "length", ToolCalls: []ToolCall{{ID: "c1", Name: "list_documents", Arguments: []byte(`{}`), Invalid: true}}}
	r := newRouteEnv([]string{CapRead}, cut, call("list_documents", `{}`), Message{Role: "assistant", Content: "ok"})
	if _, err := r.ask("Tulis daftar dokumen"); err != nil {
		t.Fatal(err)
	}
	var attempts []int
	var finishes []string
	for _, s := range r.trace.steps {
		if s.Node == NodeModelLarge {
			attempts = append(attempts, s.Attempt)
			finishes = append(finishes, s.FinishReason)
		}
	}
	if len(attempts) < 2 || attempts[0] != 1 || attempts[1] != 2 || finishes[0] != "length" {
		t.Fatalf("attempts %v finish reasons %v", attempts, finishes)
	}
}

type failingModel struct{ err error }

func (f failingModel) Step(context.Context, []Message, []ToolSpec) (Message, error) {
	return Message{}, f.err
}

func TestARunThatFailsEndsItsTraceWithTheFailureSoItIsNeverLeftHanging(t *testing.T) {
	r := newRouteEnv([]string{CapRead})
	r.chat.model = failingModel{err: errors.New("boom")}
	if _, err := r.ask("Tulis ringkasan"); err == nil {
		t.Fatal("the failure was swallowed")
	}
	last := r.trace.steps[len(r.trace.steps)-1]
	if last.Node != NodeRespond || last.Status != StatusFailed || last.Reason != "failed" {
		t.Fatalf("last step = %+v", last)
	}
}

func TestACancelledRunStillSavesItsLastStep(t *testing.T) {
	r := newRouteEnv([]string{CapRead})
	ctx, cancel := context.WithCancel(WithTrace(airuns.WithRun(context.Background(), uuid.New()), r.trace))
	r.chat.model = cancelModel{cancel: cancel}
	_, err := r.chat.Ask(ctx, ChatInput{WorkspaceID: r.ws, ConversationID: r.conv, ActorID: r.user, Question: "Tulis ringkasan", Language: "en"})
	if err == nil {
		t.Fatal("a cancelled run did not fail")
	}
	last := r.trace.steps[len(r.trace.steps)-1]
	if last.Node != NodeRespond || last.Reason != "cancelled" {
		t.Fatalf("last step = %+v", last)
	}
}

type cancelModel struct{ cancel context.CancelFunc }

func (c cancelModel) Step(ctx context.Context, _ []Message, _ []ToolSpec) (Message, error) {
	c.cancel()
	return Message{}, ctx.Err()
}

func TestAQuestionThatIsNotValidLeavesNoTrace(t *testing.T) {
	r := newRouteEnv([]string{CapRead})
	if _, err := r.ask("   "); !errors.Is(err, ErrInvalidArguments) || len(r.trace.steps) != 0 {
		t.Fatalf("error %v, steps %v", err, r.trace.steps)
	}
}

type notReadyModel struct{ scriptedModel }

func (notReadyModel) Ready(context.Context) bool { return false }

func TestASmallModelThatIsNotSetUpIsNotChosen(t *testing.T) {
	r := newRouteEnv([]string{CapRead}, Message{Role: "assistant", Content: "from the main model"})
	small := &notReadyModel{}
	r.chat.WithRouting(NewGate(r.class), small, switches{gate: true, router: true})
	answer, err := r.ask("Berapa dokumen di project Alpha?")
	if err != nil || answer.Text != "from the main model" || len(small.seen) != 0 {
		t.Fatalf("Ask() = %+v, %v, small calls %d", answer, err, len(small.seen))
	}
}

func TestTheChatRecordsItsStepsInTheStoreItWasGiven(t *testing.T) {
	e := newChatEnv([]string{CapRead}, Message{Role: "assistant", Content: "ok"})
	store := &memTrace{}
	e.chat.WithTraceStore(store)
	ctx := airuns.WithRun(context.Background(), uuid.New())
	if _, err := e.chat.Ask(ctx, ChatInput{WorkspaceID: e.ws, ConversationID: e.conv, ActorID: e.user, Question: "Tulis sesuatu", Language: "en"}); err != nil {
		t.Fatal(err)
	}
	if len(store.steps) == 0 || store.steps[0].Node != NodeInput {
		t.Fatalf("steps = %+v", store.steps)
	}
}
