// Package aisettings persists the AI provider settings and their audit trail.
package aisettings

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	app "backend/internal/application/aisettings"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Store struct{ db database.DB }

func NewStore(db database.DB) *Store { return &Store{db: db} }

// IsSuperadmin reads the role from the database on every call, so revoking it is immediate.
func (s *Store) IsSuperadmin(ctx context.Context, userID uuid.UUID) (bool, error) {
	var ok bool
	err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
		               WHERE ur.user_id = $1 AND r.slug = 'superadmin')`, userID).Scan(&ok)
	return ok, err
}

func (s *Store) Get(ctx context.Context, purpose string) (app.Record, bool, error) {
	var r app.Record
	err := s.db.QueryRowContext(ctx, `
		SELECT purpose, base_url, protocol, model, api_key_ciphertext, updated_by, updated_at, last_error, last_error_at
		FROM ai_provider_settings WHERE purpose = $1`, purpose).
		Scan(&r.Purpose, &r.BaseURL, &r.Protocol, &r.Model, &r.APIKeyCiphertext, &r.UpdatedBy, &r.UpdatedAt, &r.LastError, &r.LastErrorAt)
	if errors.Is(err, sql.ErrNoRows) {
		return app.Record{}, false, nil
	}
	return r, err == nil, err
}

func (s *Store) Put(ctx context.Context, r app.Record) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO ai_provider_settings (purpose, base_url, protocol, model, api_key_ciphertext, updated_by, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (purpose) DO UPDATE SET base_url = EXCLUDED.base_url, protocol = EXCLUDED.protocol,
		  model = EXCLUDED.model, api_key_ciphertext = EXCLUDED.api_key_ciphertext, updated_by = EXCLUDED.updated_by,
		  updated_at = NOW(), last_error = '', last_error_at = NULL`,
		r.Purpose, r.BaseURL, r.Protocol, r.Model, r.APIKeyCiphertext, r.UpdatedBy)
	return err
}

func (s *Store) Delete(ctx context.Context, purpose string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM ai_provider_settings WHERE purpose = $1`, purpose)
	return err
}

func (s *Store) RecordError(ctx context.Context, purpose, message string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE ai_provider_settings SET last_error = $2, last_error_at = NOW() WHERE purpose = $1`, purpose, message)
	return err
}

func (s *Store) ClearError(ctx context.Context, purpose string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE ai_provider_settings SET last_error = '', last_error_at = NULL WHERE purpose = $1 AND last_error <> ''`, purpose)
	return err
}

func (s *Store) AddChange(ctx context.Context, c app.Change) error {
	changes, err := json.Marshal(c.Changes)
	if err != nil {
		return err
	}
	var by *uuid.UUID
	if c.ChangedBy != uuid.Nil {
		by = &c.ChangedBy
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO ai_provider_setting_changes (purpose, changed_by, changes) VALUES ($1, $2, $3)`, c.Purpose, by, changes)
	return err
}

func (s *Store) ListChanges(ctx context.Context, limit int) ([]app.Change, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT purpose, changed_by, changed_at, changes FROM ai_provider_setting_changes ORDER BY changed_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []app.Change
	for rows.Next() {
		var c app.Change
		var by *uuid.UUID
		var raw []byte
		if err := rows.Scan(&c.Purpose, &by, &c.ChangedAt, &raw); err != nil {
			return nil, err
		}
		if by != nil {
			c.ChangedBy = *by
		}
		if err := json.Unmarshal(raw, &c.Changes); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}
