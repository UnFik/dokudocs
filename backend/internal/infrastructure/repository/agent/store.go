// Package agent stores what the Agent may do and what it asked for.
package agent

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	app "backend/internal/application/agent"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Store struct{ db database.DB }

func NewStore(db database.DB) *Store { return &Store{db: db} }

func (s *Store) AIPermissions(ctx context.Context, userID uuid.UUID) ([]string, bool, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, `SELECT to_json(capabilities)::text FROM ai_permissions WHERE user_id = $1`, userID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	caps := []string{}
	if err := json.Unmarshal([]byte(raw), &caps); err != nil {
		return nil, false, err
	}
	return caps, true, nil
}

func (s *Store) SetAIPermissions(ctx context.Context, userID uuid.UUID, caps []string) error {
	if caps == nil {
		caps = []string{}
	}
	raw, err := json.Marshal(caps)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO ai_permissions (user_id, capabilities, updated_at)
		VALUES ($1, ARRAY(SELECT jsonb_array_elements_text($2::jsonb)), NOW())
		ON CONFLICT (user_id) DO UPDATE SET capabilities = EXCLUDED.capabilities, updated_at = NOW()`, userID, string(raw))
	return err
}

func (s *Store) MarkAIAssisted(ctx context.Context, documentID uuid.UUID, suggestionIDs []uuid.UUID, userID uuid.UUID, channel string) error {
	for _, id := range suggestionIDs {
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO ai_assisted_suggestions (document_id, suggestion_id, user_id, channel) VALUES ($1, $2, $3, $4)
			ON CONFLICT (document_id, suggestion_id) DO NOTHING`, documentID, id, userID, channel); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) AIAssistedSuggestionIDs(ctx context.Context, documentID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT suggestion_id FROM ai_assisted_suggestions WHERE document_id = $1`, documentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

const actionColumns = `id, conversation_id, user_id, tool, arguments, summary, status, result`

func scanAction(row interface{ Scan(...any) error }) (app.PendingAction, error) {
	var a app.PendingAction
	var args []byte
	err := row.Scan(&a.ID, &a.ConversationID, &a.UserID, &a.Tool, &args, &a.Summary, &a.Status, &a.Result)
	a.Arguments = args
	return a, err
}

func (s *Store) CreatePendingAction(ctx context.Context, a app.PendingAction) (app.PendingAction, error) {
	return scanAction(s.db.QueryRowContext(ctx, `
		INSERT INTO agent_pending_actions (conversation_id, user_id, tool, arguments, summary)
		VALUES ($1, $2, $3, $4, $5) RETURNING `+actionColumns,
		a.ConversationID, a.UserID, a.Tool, []byte(a.Arguments), a.Summary))
}

// PendingAction returns an action only to the User it belongs to.
func (s *Store) PendingAction(ctx context.Context, id, userID uuid.UUID) (app.PendingAction, error) {
	a, err := scanAction(s.db.QueryRowContext(ctx, `SELECT `+actionColumns+` FROM agent_pending_actions WHERE id = $1 AND user_id = $2`, id, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return a, app.ErrActionNotFound
	}
	return a, err
}

func (s *Store) PendingActions(ctx context.Context, conversationID, userID uuid.UUID) ([]app.PendingAction, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+actionColumns+` FROM agent_pending_actions WHERE conversation_id = $1 AND user_id = $2 ORDER BY created_at`, conversationID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []app.PendingAction{}
	for rows.Next() {
		a, err := scanAction(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

// DecidePendingAction settles a pending action once; false when it was already decided.
func (s *Store) DecidePendingAction(ctx context.Context, id, userID uuid.UUID, status, result string) (bool, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE agent_pending_actions SET status = $3, result = $4, decided_at = NOW()
		WHERE id = $1 AND user_id = $2 AND status = 'pending'`, id, userID, status, result)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

// ClaimPendingAction marks a pending action approved before it runs, so two clicks cannot run it twice.
func (s *Store) ClaimPendingAction(ctx context.Context, id, userID uuid.UUID) (bool, error) {
	return s.DecidePendingAction(ctx, id, userID, "approved", "")
}

// FinishPendingAction records how an approved action ended.
func (s *Store) FinishPendingAction(ctx context.Context, id uuid.UUID, status, result string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE agent_pending_actions SET status = $2, result = $3 WHERE id = $1`, id, status, result)
	return err
}
