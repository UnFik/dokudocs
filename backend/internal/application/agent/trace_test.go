package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"backend/internal/application/airuns"

	"github.com/google/uuid"
)

type memTrace struct {
	steps []Step
	err   error
}

func (m *memTrace) AddSteps(_ context.Context, _ uuid.UUID, steps []Step) error {
	if m.err != nil {
		return m.err
	}
	m.steps = append(m.steps, steps...)
	return nil
}

func tracedContext(store TraceStore) (context.Context, uuid.UUID) {
	run := uuid.New()
	return WithTrace(airuns.WithRun(context.Background(), run), store), run
}

func TestStepsAreRecordedInOrderWithTheirPlaceInTheGraph(t *testing.T) {
	store := &memTrace{}
	ctx, _ := tracedContext(store)
	Record(ctx, Step{Node: NodeInput, Status: StatusOK})
	Record(ctx, Step{Node: NodeGate, Status: StatusOK, Reason: "edit_verb"})
	Record(ctx, Step{Node: NodeModelLarge, Status: StatusOK, InputTokens: 10, OutputTokens: 5, FinishReason: "stop"})
	if len(store.steps) != 3 {
		t.Fatalf("recorded %d steps", len(store.steps))
	}
	for i, s := range store.steps {
		if s.Seq != i+1 {
			t.Fatalf("step %d has sequence %d", i, s.Seq)
		}
	}
	if store.steps[1].Reason != "edit_verb" || store.steps[2].OutputTokens != 5 {
		t.Fatalf("steps = %+v", store.steps)
	}
}

func TestEveryNodeAndEdgeOfTheGraphIsKnownAndConnected(t *testing.T) {
	g := DecisionGraph()
	known := map[string]bool{}
	for _, n := range g.Nodes {
		if known[n.ID] {
			t.Fatalf("node %s is defined twice", n.ID)
		}
		known[n.ID] = true
	}
	for _, id := range []string{NodeInput, NodeContext, NodeGate, NodeReject, NodeClarify, NodeRoute, NodeModelSmall, NodeModelLarge, NodeTools, NodeApproval, NodeRespond} {
		if !known[id] {
			t.Fatalf("the graph lacks %s", id)
		}
	}
	reachable := map[string]bool{NodeInput: true}
	for changed := true; changed; {
		changed = false
		for _, e := range g.Edges {
			if !known[e.From] || !known[e.To] {
				t.Fatalf("edge %s -> %s names an unknown node", e.From, e.To)
			}
			if reachable[e.From] && !reachable[e.To] {
				reachable[e.To], changed = true, true
			}
		}
	}
	for id := range known {
		if !reachable[id] {
			t.Fatalf("node %s cannot be reached from the input", id)
		}
	}
}

func TestAStepOnAnUnknownNodeIsDroppedNotStored(t *testing.T) {
	store := &memTrace{}
	ctx, _ := tracedContext(store)
	Record(ctx, Step{Node: "made_up", Status: StatusOK})
	if len(store.steps) != 0 {
		t.Fatalf("stored %+v", store.steps)
	}
}

func TestATraceThatCannotBeSavedNeverFailsTheRun(t *testing.T) {
	ctx, _ := tracedContext(&memTrace{err: errors.New("database down")})
	Record(ctx, Step{Node: NodeInput, Status: StatusOK})
}

func TestWithoutATraceRecordingDoesNothing(t *testing.T) {
	Record(context.Background(), Step{Node: NodeInput, Status: StatusOK})
	ctx := WithTrace(context.Background(), &memTrace{})
	Record(ctx, Step{Node: NodeInput, Status: StatusOK})
}

func TestAStoredStepHasNoRoomForWhatTheUserWrote(t *testing.T) {
	raw, _ := json.Marshal(Step{})
	var fields map[string]any
	_ = json.Unmarshal(raw, &fields)
	allowed := map[string]bool{"seq": true, "node": true, "edge": true, "status": true, "startedAt": true, "durationMs": true, "model": true, "tier": true,
		"inputTokens": true, "outputTokens": true, "finishReason": true, "tool": true, "attempt": true, "reason": true}
	for name := range fields {
		if !allowed[name] {
			t.Fatalf("Step has an unexpected field %q; a trace keeps codes, counts and names, never text", name)
		}
	}
	// A reason is a short code; anything longer or with spaces is cut to nothing.
	store := &memTrace{}
	ctx, _ := tracedContext(store)
	Record(ctx, Step{Node: NodeGate, Status: StatusOK, Reason: "please summarize my private contract for ACME"})
	if r := store.steps[0].Reason; r != "" && strings.Contains(r, " ") {
		t.Fatalf("a sentence was kept as a reason: %q", r)
	}
}
