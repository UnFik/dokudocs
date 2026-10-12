// Package aiusage stores the counts of Dokudocs model calls.
package aiusage

import (
	"context"
	"time"

	app "backend/internal/application/aiusage"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Store struct{ db database.DB }

func NewStore(db database.DB) *Store { return &Store{db: db} }

func nullable(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func (s *Store) RecordUsage(ctx context.Context, r app.Record) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO ai_model_usage (provider, model, purpose, feature, input_tokens, output_tokens, user_id, workspace_id, ok)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		r.Provider, r.Model, r.Purpose, r.Feature, r.InputTokens, r.OutputTokens, nullable(r.UserID), nullable(r.WorkspaceID), r.OK)
	return err
}

const totals = `COUNT(*), COUNT(*) FILTER (WHERE NOT ok), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)`

func (s *Store) UsageSummary(ctx context.Context, since time.Time, topUsers int) (app.Summary, error) {
	out := app.Summary{Since: since, Days: []app.DayTotal{}, Models: []app.ModelTotal{}, Purposes: []app.PurposeTotal{}, TopUsers: []app.UserTotal{}}
	if err := s.db.QueryRowContext(ctx, `SELECT `+totals+` FROM ai_model_usage WHERE at >= $1`, since).
		Scan(&out.Overall.Calls, &out.Overall.Failed, &out.Overall.InputTokens, &out.Overall.OutputTokens); err != nil {
		return out, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT to_char(date_trunc('day', at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, `+totals+`
		FROM ai_model_usage WHERE at >= $1 GROUP BY day ORDER BY day`, since)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var d app.DayTotal
		if err := rows.Scan(&d.Day, &d.Calls, &d.Failed, &d.InputTokens, &d.OutputTokens); err != nil {
			rows.Close()
			return out, err
		}
		out.Days = append(out.Days, d)
	}
	rows.Close()
	rows, err = s.db.QueryContext(ctx, `
		SELECT provider, model, `+totals+` FROM ai_model_usage WHERE at >= $1
		GROUP BY provider, model ORDER BY SUM(input_tokens + output_tokens) DESC, model`, since)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var m app.ModelTotal
		if err := rows.Scan(&m.Provider, &m.Model, &m.Calls, &m.Failed, &m.InputTokens, &m.OutputTokens); err != nil {
			rows.Close()
			return out, err
		}
		out.Models = append(out.Models, m)
	}
	rows.Close()
	rows, err = s.db.QueryContext(ctx, `
		SELECT purpose, feature, `+totals+` FROM ai_model_usage WHERE at >= $1
		GROUP BY purpose, feature ORDER BY purpose, feature`, since)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var p app.PurposeTotal
		if err := rows.Scan(&p.Purpose, &p.Feature, &p.Calls, &p.Failed, &p.InputTokens, &p.OutputTokens); err != nil {
			rows.Close()
			return out, err
		}
		out.Purposes = append(out.Purposes, p)
	}
	rows.Close()
	rows, err = s.db.QueryContext(ctx, `
		SELECT u.id, u.full_name, u.email, COUNT(*), COUNT(*) FILTER (WHERE NOT m.ok), COALESCE(SUM(m.input_tokens), 0), COALESCE(SUM(m.output_tokens), 0)
		FROM ai_model_usage m JOIN users u ON u.id = m.user_id WHERE m.at >= $1
		GROUP BY u.id, u.full_name, u.email ORDER BY SUM(m.input_tokens + m.output_tokens) DESC LIMIT $2`, since, topUsers)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var u app.UserTotal
		if err := rows.Scan(&u.UserID, &u.Name, &u.Email, &u.Calls, &u.Failed, &u.InputTokens, &u.OutputTokens); err != nil {
			return out, err
		}
		out.TopUsers = append(out.TopUsers, u)
	}
	return out, rows.Err()
}

// MonthlyTokens counts what a User's answers, Agent runs and titles used in a
// Workspace. Embeddings and the Superadmin's connection test are not the User's.
func (s *Store) MonthlyTokens(ctx context.Context, userID, workspaceID uuid.UUID, since time.Time) (int64, error) {
	var used int64
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM ai_model_usage
		WHERE user_id = $1 AND workspace_id = $2 AND at >= $3
		  AND purpose <> 'embedding' AND feature <> 'connection_test'
	`, userID, workspaceID, since).Scan(&used)
	return used, err
}

// PlanLimit is the monthly token limit for the Workspace's Plan, or the Free
// limit when the Plan has none.
func (s *Store) PlanLimit(ctx context.Context, workspaceID uuid.UUID) (int64, error) {
	var limit int64
	err := s.db.QueryRowContext(ctx, `
		SELECT COALESCE(
			(SELECT l.monthly_tokens FROM ai_plan_limits l WHERE l.plan = w.plan),
			(SELECT monthly_tokens FROM ai_plan_limits WHERE plan = 'Free'))
		FROM workspaces w WHERE w.id = $1
	`, workspaceID).Scan(&limit)
	return limit, err
}
