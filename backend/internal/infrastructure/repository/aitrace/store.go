// Package aitrace stores how Agent requests went through the decision graph.
package aitrace

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"backend/internal/application/agent"
	app "backend/internal/application/aitrace"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Store struct{ db database.DB }

func NewStore(db database.DB) *Store { return &Store{db: db} }

// AddSteps keeps steps of a run. The trace is made from the run's row the first time;
// a step written twice is kept once.
func (s *Store) AddSteps(ctx context.Context, run uuid.UUID, steps []agent.Step) error {
	if len(steps) == 0 {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO ai_run_traces (run_id, owner_id, workspace_id, conversation_id, started_at)
		SELECT id, owner_id, workspace_id, conversation_id, started_at FROM ai_runs WHERE id = $1
		ON CONFLICT DO NOTHING`, run); err != nil {
		return err
	}
	// A run without a row (or already gone) still gets a trace, without an owner.
	if _, err := s.db.ExecContext(ctx, `INSERT INTO ai_run_traces (run_id, started_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`, run, steps[0].StartedAt); err != nil {
		return err
	}
	for _, st := range steps {
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO ai_run_steps (run_id, seq, node, edge, status, started_at, duration_ms, model, tier, input_tokens, output_tokens, finish_reason, tool, attempt, reason)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			ON CONFLICT (run_id, seq) DO NOTHING`,
			run, st.Seq, st.Node, st.Edge, st.Status, st.StartedAt, st.DurationMS, st.Model, st.Tier, st.InputTokens, st.OutputTokens, st.FinishReason, st.Tool, st.Attempt, st.Reason); err != nil {
			return err
		}
	}
	return nil
}

const summaryFrom = `
	FROM ai_run_traces t
	LEFT JOIN users u ON u.id = t.owner_id
	LEFT JOIN LATERAL (
		SELECT count(*) AS steps,
			count(*) FILTER (WHERE node IN ('model_small', 'model_large')) AS model_calls,
			count(*) FILTER (WHERE node = 'tools') AS tool_calls,
			COALESCE(sum(input_tokens), 0) AS in_tokens,
			COALESCE(sum(output_tokens), 0) AS out_tokens,
			COALESCE((extract(epoch FROM max(started_at + duration_ms * interval '1 millisecond') - min(started_at)) * 1000)::bigint, 0) AS duration_ms,
			COALESCE((array_agg(node ORDER BY seq DESC))[1], '') AS outcome,
			COALESCE(bool_or(status = 'failed'), false) AS failed
		FROM ai_run_steps WHERE run_id = t.run_id
	) s ON true`

const summaryColumns = `t.run_id, t.owner_id, COALESCE(u.full_name, ''), COALESCE(u.email, ''), t.workspace_id, t.conversation_id, t.started_at,
	s.steps, s.model_calls, s.tool_calls, s.in_tokens, s.out_tokens, s.duration_ms, s.outcome, s.failed`

func scanSummary(row interface{ Scan(...any) error }, extra ...any) (app.RunSummary, error) {
	var r app.RunSummary
	dest := append([]any{&r.RunID, &r.OwnerID, &r.OwnerName, &r.OwnerEmail, &r.WorkspaceID, &r.ConversationID, &r.StartedAt,
		&r.Steps, &r.ModelCalls, &r.ToolCalls, &r.InputTokens, &r.OutputTokens, &r.DurationMS, &r.Outcome, &r.Failed}, extra...)
	err := row.Scan(dest...)
	return r, err
}

func (s *Store) List(ctx context.Context, f app.Filter) ([]app.RunSummary, int, error) {
	var where []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if f.UserID != nil {
		where = append(where, "t.owner_id = "+arg(*f.UserID))
	}
	if f.WorkspaceID != nil {
		where = append(where, "t.workspace_id = "+arg(*f.WorkspaceID))
	}
	if f.ConversationID != nil {
		where = append(where, "t.conversation_id = "+arg(*f.ConversationID))
	}
	if f.Outcome != "" {
		where = append(where, "s.outcome = "+arg(f.Outcome))
	}
	if f.Node != "" {
		where = append(where, "EXISTS (SELECT 1 FROM ai_run_steps x WHERE x.run_id = t.run_id AND x.node = "+arg(f.Node)+")")
	}
	if f.Since != nil {
		where = append(where, "t.started_at >= "+arg(*f.Since))
	}
	if f.Until != nil {
		where = append(where, "t.started_at < "+arg(*f.Until))
	}
	if f.MinDurationMS > 0 {
		where = append(where, "s.duration_ms >= "+arg(f.MinDurationMS))
	}
	if f.FailedOnly {
		where = append(where, "s.failed")
	}
	clause := ""
	if len(where) > 0 {
		clause = " WHERE " + strings.Join(where, " AND ")
	}
	limit, offset := arg(f.Limit), arg(f.Offset)
	rows, err := s.db.QueryContext(ctx, `SELECT `+summaryColumns+`, count(*) OVER () `+summaryFrom+clause+
		` ORDER BY t.started_at DESC, t.run_id LIMIT `+limit+` OFFSET `+offset, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := []app.RunSummary{}
	total := 0
	for rows.Next() {
		r, err := scanSummary(rows, &total)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if len(out) == 0 && f.Offset > 0 {
		// A page past the end: the total is still worth knowing.
		if err := s.db.QueryRowContext(ctx, `SELECT count(*) `+summaryFrom+clause, args[:len(args)-2]...).Scan(&total); err != nil {
			return nil, 0, err
		}
	}
	return out, total, nil
}

func (s *Store) Get(ctx context.Context, run uuid.UUID) (app.RunSummary, []agent.Step, error) {
	summary, err := scanSummary(s.db.QueryRowContext(ctx, `SELECT `+summaryColumns+summaryFrom+` WHERE t.run_id = $1`, run))
	if errors.Is(err, sql.ErrNoRows) {
		return app.RunSummary{}, nil, app.ErrNotFound
	}
	if err != nil {
		return app.RunSummary{}, nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT seq, node, edge, status, started_at, duration_ms, model, tier, input_tokens, output_tokens, finish_reason, tool, attempt, reason
		FROM ai_run_steps WHERE run_id = $1 ORDER BY seq`, run)
	if err != nil {
		return app.RunSummary{}, nil, err
	}
	defer rows.Close()
	steps := []agent.Step{}
	for rows.Next() {
		var st agent.Step
		if err := rows.Scan(&st.Seq, &st.Node, &st.Edge, &st.Status, &st.StartedAt, &st.DurationMS, &st.Model, &st.Tier, &st.InputTokens, &st.OutputTokens, &st.FinishReason, &st.Tool, &st.Attempt, &st.Reason); err != nil {
			return app.RunSummary{}, nil, err
		}
		steps = append(steps, st)
	}
	return summary, steps, rows.Err()
}

func (s *Store) Prune(ctx context.Context, before time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM ai_run_traces WHERE started_at < $1`, before)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *Store) Settings(ctx context.Context) (app.Settings, error) {
	var out app.Settings
	err := s.db.QueryRowContext(ctx, `SELECT gate_enabled, router_enabled, trace_retention_days, updated_at FROM ai_harness_settings WHERE id = 1`).
		Scan(&out.GateEnabled, &out.RouterEnabled, &out.TraceRetentionDays, &out.UpdatedAt)
	return out, err
}

func (s *Store) SaveSettings(ctx context.Context, v app.Settings, by uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `UPDATE ai_harness_settings SET gate_enabled = $1, router_enabled = $2, trace_retention_days = $3, updated_by = $4, updated_at = NOW() WHERE id = 1`,
		v.GateEnabled, v.RouterEnabled, v.TraceRetentionDays, by)
	return err
}
