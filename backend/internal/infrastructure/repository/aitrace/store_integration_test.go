//go:build integration

package aitrace

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"backend/internal/application/agent"
	app "backend/internal/application/aitrace"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func open(t *testing.T) (*Store, *sql.DB) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("TEST_DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStore(database.NewSQLDB(db)), db
}

func newUser(t *testing.T, db *sql.DB, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.QueryRow(`INSERT INTO users (account_no, email, full_name) VALUES ($1, $2, $3) RETURNING id`,
		uuid.NewString(), fmt.Sprintf("trace-%s@example.invalid", uuid.NewString()), name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(`DELETE FROM users WHERE id = $1`, id) })
	return id
}

// newRun inserts the ai_runs row a trace is made for.
func newRun(t *testing.T, db *sql.DB, owner uuid.UUID, at time.Time) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := db.QueryRow(`INSERT INTO ai_runs (owner_id, kind, idempotency_key, fingerprint, instance_id, started_at, deadline)
		VALUES ($1, 'chat', $2, 'f', $3, $4, now() + interval '1 hour') RETURNING id`, owner, uuid.NewString(), uuid.New(), at).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func path(t0 time.Time) []agent.Step {
	at := func(ms int) time.Time { return t0.Add(time.Duration(ms) * time.Millisecond) }
	return []agent.Step{
		{Seq: 1, Node: agent.NodeInput, Status: agent.StatusOK, StartedAt: at(0)},
		{Seq: 2, Node: agent.NodeGate, Edge: "edit", Status: agent.StatusOK, StartedAt: at(5), DurationMS: 2, Reason: "edit_verb", Tier: "rule"},
		{Seq: 3, Node: agent.NodeModelLarge, Edge: agent.EdgeFull, Status: agent.StatusOK, StartedAt: at(10), DurationMS: 400, Model: "m", InputTokens: 100, OutputTokens: 20, FinishReason: "tool_calls", Attempt: 1},
		{Seq: 4, Node: agent.NodeTools, Status: agent.StatusOK, StartedAt: at(420), DurationMS: 30, Tool: "list_documents"},
		{Seq: 5, Node: agent.NodeModelLarge, Edge: agent.EdgeToolResult, Status: agent.StatusOK, StartedAt: at(460), DurationMS: 300, InputTokens: 150, OutputTokens: 40, FinishReason: "stop", Attempt: 1},
		{Seq: 6, Node: agent.NodeRespond, Edge: agent.EdgeAnswer, Status: agent.StatusOK, StartedAt: at(770)},
	}
}

func TestStepsAreKeptInOrderAndSummarisedForTheList(t *testing.T) {
	s, db := open(t)
	ctx := context.Background()
	owner := newUser(t, db, "Trace Owner")
	run := newRun(t, db, owner, time.Now().Add(-time.Minute))
	steps := path(time.Now().Add(-time.Minute))
	if err := s.AddSteps(ctx, run, steps[:3]); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSteps(ctx, run, steps[3:]); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSteps(ctx, run, steps[:1]); err != nil {
		t.Fatalf("a step written twice failed the run: %v", err)
	}
	summary, got, err := s.Get(ctx, run)
	if err != nil || len(got) != 6 || got[0].Node != agent.NodeInput || got[5].Node != agent.NodeRespond {
		t.Fatalf("Get() = %+v, %d steps, %v", summary, len(got), err)
	}
	if got[2].Model != "m" || got[3].Tool != "list_documents" || got[1].Reason != "edit_verb" {
		t.Fatalf("steps lost their fields: %+v", got)
	}
	if summary.Steps != 6 || summary.ModelCalls != 2 || summary.ToolCalls != 1 || summary.InputTokens != 250 || summary.OutputTokens != 60 ||
		summary.Outcome != agent.NodeRespond || summary.Failed || summary.OwnerName != "Trace Owner" || summary.DurationMS < 700 {
		t.Fatalf("summary = %+v", summary)
	}
}

func TestATraceOutlivesItsRunButNotItsOwner(t *testing.T) {
	s, db := open(t)
	ctx := context.Background()
	owner := newUser(t, db, "Short Lived")
	run := newRun(t, db, owner, time.Now())
	if err := s.AddSteps(ctx, run, path(time.Now())[:2]); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DELETE FROM ai_runs WHERE id = $1`, run); err != nil {
		t.Fatal(err)
	}
	if _, steps, err := s.Get(ctx, run); err != nil || len(steps) != 2 {
		t.Fatalf("the trace went with its run: %d steps, %v", len(steps), err)
	}
	if _, err := db.Exec(`DELETE FROM users WHERE id = $1`, owner); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Get(ctx, run); err == nil {
		t.Fatal("the trace stayed after its owner was deleted")
	}
}

func TestAStepOfARunWithoutARowStillMakesATrace(t *testing.T) {
	s, _ := open(t)
	run := uuid.New()
	if err := s.AddSteps(context.Background(), run, path(time.Now())[:1]); err != nil {
		t.Fatal(err)
	}
	if summary, _, err := s.Get(context.Background(), run); err != nil || summary.OwnerID != nil {
		t.Fatalf("Get() = %+v, %v", summary, err)
	}
}

func TestAMissingTraceIsNotFound(t *testing.T) {
	s, _ := open(t)
	if _, _, err := s.Get(context.Background(), uuid.New()); err != app.ErrNotFound {
		t.Fatalf("error = %v", err)
	}
}

func TestTheListFiltersByWhoWhereHowItEndedAndHowLong(t *testing.T) {
	s, db := open(t)
	ctx := context.Background()
	alice, bob := newUser(t, db, "Alice"), newUser(t, db, "Bob")
	now := time.Now()
	fine := newRun(t, db, alice, now.Add(-3*time.Hour))
	if err := s.AddSteps(ctx, fine, path(now.Add(-3*time.Hour))); err != nil {
		t.Fatal(err)
	}
	broken := newRun(t, db, bob, now.Add(-time.Hour))
	if err := s.AddSteps(ctx, broken, []agent.Step{
		{Seq: 1, Node: agent.NodeInput, Status: agent.StatusOK, StartedAt: now.Add(-time.Hour)},
		{Seq: 2, Node: agent.NodeModelLarge, Status: agent.StatusFailed, StartedAt: now.Add(-time.Hour), DurationMS: 90, Reason: "provider_unavailable", Attempt: 1},
		{Seq: 3, Node: agent.NodeRespond, Status: agent.StatusFailed, StartedAt: now.Add(-time.Hour), Reason: "provider_unavailable"},
	}); err != nil {
		t.Fatal(err)
	}
	rejected := newRun(t, db, alice, now.Add(-10*time.Minute))
	if err := s.AddSteps(ctx, rejected, []agent.Step{
		{Seq: 1, Node: agent.NodeInput, Status: agent.StatusOK, StartedAt: now.Add(-10 * time.Minute)},
		{Seq: 2, Node: agent.NodeGate, Status: agent.StatusOK, StartedAt: now.Add(-10 * time.Minute)},
		{Seq: 3, Node: agent.NodeReject, Status: agent.StatusRejected, StartedAt: now.Add(-10 * time.Minute), Reason: "classifier"},
	}); err != nil {
		t.Fatal(err)
	}
	mine := func(f app.Filter) []uuid.UUID {
		t.Helper()
		f.Limit = 50
		list, _, err := s.List(ctx, f)
		if err != nil {
			t.Fatal(err)
		}
		out := []uuid.UUID{}
		for _, r := range list {
			out = append(out, r.RunID)
		}
		return out
	}
	only := func(want ...uuid.UUID) func([]uuid.UUID) bool {
		return func(got []uuid.UUID) bool {
			if len(got) != len(want) {
				return false
			}
			for i := range want {
				if got[i] != want[i] {
					return false
				}
			}
			return true
		}
	}
	checks := []struct {
		name string
		f    app.Filter
		ok   func([]uuid.UUID) bool
	}{
		{"by user, newest first", app.Filter{UserID: &alice}, only(rejected, fine)},
		{"failed only", app.Filter{UserID: &bob, FailedOnly: true}, only(broken)},
		{"by outcome", app.Filter{UserID: &alice, Outcome: agent.NodeReject}, only(rejected)},
		{"by node reached", app.Filter{UserID: &alice, Node: agent.NodeTools}, only(fine)},
		{"by length", app.Filter{UserID: &alice, MinDurationMS: 500}, only(fine)},
		{"by time", app.Filter{UserID: &alice, Since: ptr(now.Add(-30 * time.Minute))}, only(rejected)},
		{"by time, until", app.Filter{UserID: &alice, Until: ptr(now.Add(-time.Hour))}, only(fine)},
	}
	for _, c := range checks {
		if got := mine(c.f); !c.ok(got) {
			t.Errorf("%s: got %v", c.name, got)
		}
	}
	list, total, err := s.List(ctx, app.Filter{UserID: &alice, Limit: 1, Offset: 1})
	if err != nil || total != 2 || len(list) != 1 || list[0].RunID != fine {
		t.Fatalf("paging: %+v total %d, %v", list, total, err)
	}
}

func ptr[T any](v T) *T { return &v }

func TestPruneDropsOnlyTheOldTraces(t *testing.T) {
	s, db := open(t)
	ctx := context.Background()
	owner := newUser(t, db, "Pruned")
	old, recent := newRun(t, db, owner, time.Now().AddDate(0, 0, -40)), newRun(t, db, owner, time.Now())
	if err := s.AddSteps(ctx, old, path(time.Now().AddDate(0, 0, -40))[:1]); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSteps(ctx, recent, path(time.Now())[:1]); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Prune(ctx, time.Now().AddDate(0, 0, -30)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Get(ctx, old); err != app.ErrNotFound {
		t.Fatalf("the old trace stayed: %v", err)
	}
	if _, _, err := s.Get(ctx, recent); err != nil {
		t.Fatalf("the recent trace went: %v", err)
	}
}

func TestTheSettingsStartOnAndCanBeSaved(t *testing.T) {
	s, db := open(t)
	ctx := context.Background()
	admin := newUser(t, db, "Admin")
	t.Cleanup(func() {
		_, _ = db.Exec(`UPDATE ai_harness_settings SET gate_enabled = TRUE, router_enabled = TRUE, trace_retention_days = 30`)
	})
	got, err := s.Settings(ctx)
	if err != nil || !got.GateEnabled || !got.RouterEnabled || got.TraceRetentionDays != 30 {
		t.Fatalf("Settings() = %+v, %v", got, err)
	}
	if err := s.SaveSettings(ctx, app.Settings{GateEnabled: false, RouterEnabled: true, TraceRetentionDays: 7}, admin); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Settings(ctx); got.GateEnabled || !got.RouterEnabled || got.TraceRetentionDays != 7 {
		t.Fatalf("after save: %+v", got)
	}
}
