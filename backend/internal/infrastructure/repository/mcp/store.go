// Package mcp stores MCP API keys, the Superadmin's MCP settings, the audit trail and Skills.
package mcp

import (
	"context"
	"database/sql"
	"errors"
	"time"

	app "backend/internal/application/mcp"
	"backend/internal/application/skills"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Store struct{ db database.DB }

func NewStore(db database.DB) *Store { return &Store{db: db} }

const keyColumns = `id, user_id, name, prefix, expires_at, last_used_at, revoked_at, created_at`

func scanKey(row interface{ Scan(...any) error }) (app.Key, error) {
	var k app.Key
	err := row.Scan(&k.ID, &k.UserID, &k.Name, &k.Prefix, &k.ExpiresAt, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt)
	return k, err
}

func (s *Store) CreateKey(ctx context.Context, k app.Key, hash string) (app.Key, error) {
	return scanKey(s.db.QueryRowContext(ctx, `
		INSERT INTO mcp_api_keys (user_id, name, prefix, key_hash, expires_at) VALUES ($1, $2, $3, $4, $5)
		RETURNING `+keyColumns, k.UserID, k.Name, k.Prefix, hash, k.ExpiresAt))
}

func (s *Store) ListKeys(ctx context.Context, userID uuid.UUID) ([]app.Key, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+keyColumns+` FROM mcp_api_keys WHERE user_id = $1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []app.Key{}
	for rows.Next() {
		k, err := scanKey(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (s *Store) RevokeKey(ctx context.Context, userID, id uuid.UUID) (bool, error) {
	res, err := s.db.ExecContext(ctx, `UPDATE mcp_api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, id, userID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

func (s *Store) KeyByHash(ctx context.Context, hash string) (app.Key, bool, error) {
	k, err := scanKey(s.db.QueryRowContext(ctx, `SELECT `+keyColumns+` FROM mcp_api_keys WHERE key_hash = $1`, hash))
	if errors.Is(err, sql.ErrNoRows) {
		return app.Key{}, false, nil
	}
	return k, err == nil, err
}

func (s *Store) TouchKey(ctx context.Context, id uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `UPDATE mcp_api_keys SET last_used_at = NOW() WHERE id = $1`, id)
	return err
}

func (s *Store) MCPSettings(ctx context.Context) (app.Settings, error) {
	var out app.Settings
	err := s.db.QueryRowContext(ctx, `
		SELECT enabled, read_per_minute, write_per_minute, max_result_bytes, audit_retention_days, updated_at
		FROM mcp_settings WHERE id = 1`).Scan(&out.Enabled, &out.ReadPerMinute, &out.WritePerMinute, &out.MaxResultBytes, &out.AuditRetentionDays, &out.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return app.DefaultSettings, nil
	}
	return out, err
}

func (s *Store) SaveMCPSettings(ctx context.Context, v app.Settings, by uuid.UUID) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO mcp_settings (id, enabled, read_per_minute, write_per_minute, max_result_bytes, audit_retention_days, updated_by, updated_at)
		VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, read_per_minute = EXCLUDED.read_per_minute,
		  write_per_minute = EXCLUDED.write_per_minute, max_result_bytes = EXCLUDED.max_result_bytes,
		  audit_retention_days = EXCLUDED.audit_retention_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
		v.Enabled, v.ReadPerMinute, v.WritePerMinute, v.MaxResultBytes, v.AuditRetentionDays, by)
	return err
}

func nullable(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func (s *Store) AddAudit(ctx context.Context, e app.AuditEntry) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO mcp_audit (key_id, user_id, tool, resource, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6)`,
		nullable(e.KeyID), nullable(e.UserID), e.Tool, e.Resource, e.Outcome, e.Detail)
	return err
}

func (s *Store) ListAudit(ctx context.Context, userID *uuid.UUID, limit int) ([]app.AuditEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.at, a.key_id, COALESCE(k.name, ''), a.user_id, COALESCE(u.full_name, ''), a.tool, a.resource, a.outcome, a.detail
		FROM mcp_audit a
		LEFT JOIN mcp_api_keys k ON k.id = a.key_id
		LEFT JOIN users u ON u.id = a.user_id
		WHERE $1::uuid IS NULL OR a.user_id = $1
		ORDER BY a.at DESC, a.id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.AuditEntry{}
	for rows.Next() {
		var e app.AuditEntry
		var keyID, uid *uuid.UUID
		if err := rows.Scan(&e.At, &keyID, &e.KeyName, &uid, &e.UserName, &e.Tool, &e.Resource, &e.Outcome, &e.Detail); err != nil {
			return nil, err
		}
		if keyID != nil {
			e.KeyID = *keyID
		}
		if uid != nil {
			e.UserID = *uid
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) PruneAudit(ctx context.Context, before time.Time) (int64, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM mcp_audit WHERE at < $1`, before)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

const skillColumns = `id, name, description, instructions, updated_at`

func scanSkill(row interface{ Scan(...any) error }) (skills.Skill, error) {
	var sk skills.Skill
	err := row.Scan(&sk.ID, &sk.Name, &sk.Description, &sk.Instructions, &sk.UpdatedAt)
	return sk, err
}

func (s *Store) ListSkills(ctx context.Context) ([]skills.Skill, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+skillColumns+` FROM skills ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []skills.Skill{}
	for rows.Next() {
		sk, err := scanSkill(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, sk)
	}
	return out, rows.Err()
}

func (s *Store) SkillByName(ctx context.Context, name string) (skills.Skill, bool, error) {
	sk, err := scanSkill(s.db.QueryRowContext(ctx, `SELECT `+skillColumns+` FROM skills WHERE name = $1`, name))
	if errors.Is(err, sql.ErrNoRows) {
		return skills.Skill{}, false, nil
	}
	return sk, err == nil, err
}

// ErrSkillNameTaken means another Skill already has the name.
var ErrSkillNameTaken = errors.New("another skill already has this name")

func (s *Store) SaveSkill(ctx context.Context, sk skills.Skill, by uuid.UUID) (skills.Skill, error) {
	var row *sql.Row
	if sk.ID == uuid.Nil {
		row = s.db.QueryRowContext(ctx, `INSERT INTO skills (name, description, instructions, updated_by) VALUES ($1, $2, $3, $4)
			ON CONFLICT (name) DO NOTHING RETURNING `+skillColumns, sk.Name, sk.Description, sk.Instructions, by)
	} else {
		row = s.db.QueryRowContext(ctx, `UPDATE skills SET name = $2, description = $3, instructions = $4, updated_by = $5, updated_at = NOW()
			WHERE id = $1 RETURNING `+skillColumns, sk.ID, sk.Name, sk.Description, sk.Instructions, by)
	}
	saved, err := scanSkill(row)
	if errors.Is(err, sql.ErrNoRows) {
		if sk.ID == uuid.Nil {
			return skills.Skill{}, ErrSkillNameTaken
		}
		return skills.Skill{}, skills.ErrInvalid
	}
	if err != nil && isUniqueViolation(err) {
		return skills.Skill{}, ErrSkillNameTaken
	}
	return saved, err
}

func (s *Store) DeleteSkill(ctx context.Context, id uuid.UUID) (bool, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM skills WHERE id = $1`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n == 1, err
}

func isUniqueViolation(err error) bool {
	type sqlState interface{ SQLState() string }
	var state sqlState
	return errors.As(err, &state) && state.SQLState() == "23505"
}
