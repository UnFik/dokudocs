// Package push keeps the browser tokens people registered for notifications.
package push

import (
	"context"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Store struct{ db database.DB }

func NewStore(db database.DB) *Store { return &Store{db: db} }

// Save registers a browser for a person. A token already held by someone else
// moves to them: it is the same browser, signed in as someone new.
func (s *Store) Save(ctx context.Context, userID uuid.UUID, token, userAgent string) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO push_tokens (user_id, token, user_agent) VALUES ($1, $2, $3)
		ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, user_agent = EXCLUDED.user_agent, last_seen_at = NOW()
	`, userID, token, userAgent)
	return err
}

// Remove forgets a token, if it is the person's own.
func (s *Store) Remove(ctx context.Context, userID uuid.UUID, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM push_tokens WHERE user_id = $1 AND token = $2`, userID, token)
	return err
}

// Drop forgets a token whoever holds it, once Firebase has said it is gone.
func (s *Store) Drop(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM push_tokens WHERE token = $1`, token)
	return err
}

// Tokens are the browsers a person registered, newest first.
func (s *Store) Tokens(ctx context.Context, userID uuid.UUID) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT token FROM push_tokens WHERE user_id = $1 ORDER BY last_seen_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tokens []string
	for rows.Next() {
		var token string
		if err := rows.Scan(&token); err != nil {
			return nil, err
		}
		tokens = append(tokens, token)
	}
	return tokens, rows.Err()
}
