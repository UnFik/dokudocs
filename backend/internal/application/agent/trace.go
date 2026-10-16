package agent

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"backend/internal/application/airuns"

	"github.com/google/uuid"
)

// Step statuses.
const (
	StatusOK       = "ok"
	StatusFailed   = "failed"
	StatusWaiting  = "waiting"
	StatusRejected = "rejected"
)

// Step is one place a request passed through. It holds codes, counts and names only: a
// Superadmin reads a trace to see how a request went, never what the User wrote or
// what a tool returned, so there is no field that could hold text.
type Step struct {
	Seq          int       `json:"seq"`
	Node         string    `json:"node"`
	Edge         string    `json:"edge"`
	Status       string    `json:"status"`
	StartedAt    time.Time `json:"startedAt"`
	DurationMS   int64     `json:"durationMs"`
	Model        string    `json:"model"`
	Tier         string    `json:"tier"`
	InputTokens  int       `json:"inputTokens"`
	OutputTokens int       `json:"outputTokens"`
	FinishReason string    `json:"finishReason"`
	Tool         string    `json:"tool"`
	Attempt      int       `json:"attempt"`
	Reason       string    `json:"reason"`
}

type TraceStore interface {
	AddSteps(ctx context.Context, runID uuid.UUID, steps []Step) error
}

type traceKey struct{}

type tracer struct {
	store TraceStore
	mu    sync.Mutex
	seq   int
}

// WithTrace makes the work in ctx record its steps. A trace follows a run, so without
// a run in ctx nothing is recorded.
func WithTrace(ctx context.Context, store TraceStore) context.Context {
	if store == nil {
		return ctx
	}
	return context.WithValue(ctx, traceKey{}, &tracer{store: store})
}

// maxReasonRunes keeps a reason a code.
const maxReasonRunes = 40

// Record adds a step to the run's trace. It never fails the run: a trace that cannot
// be saved is logged and lost.
func Record(ctx context.Context, step Step) {
	t, ok := ctx.Value(traceKey{}).(*tracer)
	run := airuns.RunID(ctx)
	if !ok || run == uuid.Nil || !knownNode(step.Node) {
		return
	}
	step.Reason = reasonCode(step.Reason)
	step.Tool = truncate(step.Tool, 64)
	step.Model = truncate(step.Model, 100)
	if step.StartedAt.IsZero() {
		step.StartedAt = time.Now()
	}
	t.mu.Lock()
	t.seq++
	step.Seq = t.seq
	t.mu.Unlock()
	// A cancelled run still saves how far it got.
	save, stop := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer stop()
	if err := t.store.AddSteps(save, run, []Step{step}); err != nil {
		slog.WarnContext(ctx, "agent trace step not saved", "run_id", run, "node", step.Node, "error", err)
	}
}

// reasonCode keeps a reason only when it looks like a code (lowercase words joined by
// underscores): a sentence cannot slip into a trace through it.
func reasonCode(reason string) string {
	if len(reason) > maxReasonRunes {
		return ""
	}
	for _, r := range reason {
		if !(r == '_' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return ""
		}
	}
	return reason
}

// traceBegan says whether the run has recorded a step.
func traceBegan(ctx context.Context) bool {
	t, ok := ctx.Value(traceKey{}).(*tracer)
	if !ok {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.seq > 0
}
