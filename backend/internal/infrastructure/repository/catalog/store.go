// Package catalog keeps the Architecture catalog and the requests for missing entries.
package catalog

import (
	"context"
	"database/sql"
	"errors"

	appcatalog "backend/internal/application/catalog"
	"backend/internal/infrastructure/database"
)

type Store struct{ db database.DB }

func NewStore(db database.DB) *Store { return &Store{db: db} }

func (s *Store) ListEntries(ctx context.Context) ([]appcatalog.Entry, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT slug, category::text, subkind, name, family, sort_order, deprecated
		FROM catalog_entries ORDER BY category, subkind, sort_order, slug`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []appcatalog.Entry{}
	for rows.Next() {
		var e appcatalog.Entry
		var family sql.NullString
		if err := rows.Scan(&e.Slug, &e.Category, &e.Subkind, &e.Name, &family, &e.SortOrder, &e.Deprecated); err != nil {
			return nil, err
		}
		if family.Valid {
			e.Family = &family.String
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

func (s *Store) FindEntry(ctx context.Context, key string) (string, error) {
	var slug string
	err := s.db.QueryRowContext(ctx, `
		SELECT slug FROM catalog_entries
		WHERE regexp_replace(lower(name), '[^a-z0-9]', '', 'g') = $1 OR replace(slug, '-', '') = $1
		ORDER BY slug LIMIT 1`, key).Scan(&slug)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return slug, err
}

func (s *Store) AddRequest(ctx context.Context, input appcatalog.RequestInput, key string) (appcatalog.RequestResult, error) {
	var result appcatalog.RequestResult
	err := s.db.WithTransaction(ctx, func(tx database.Queryer) error {
		var isMember bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2)`,
			input.WorkspaceID, input.UserID).Scan(&isMember); err != nil {
			return err
		}
		if !isMember {
			return appcatalog.ErrNotMember
		}
		err := tx.QueryRowContext(ctx, `SELECT id, name FROM catalog_requests WHERE name_key = $1 FOR UPDATE`, key).Scan(&result.ID, &result.Name)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			var open int
			if err := tx.QueryRowContext(ctx, `
				SELECT COUNT(*) FROM catalog_request_votes v JOIN catalog_requests r ON r.id = v.request_id
				WHERE v.user_id = $1 AND r.status = 'open'`, input.UserID).Scan(&open); err != nil {
				return err
			}
			if open >= appcatalog.MaxOpenRequests {
				return appcatalog.ErrTooManyRequests
			}
			// Two people asking at once meet on the unique key; the second joins the first.
			if err := tx.QueryRowContext(ctx, `
				INSERT INTO catalog_requests (name, name_key, category, website, note, created_by)
				VALUES ($1, $2, $3::catalog_category, NULLIF($4, ''), NULLIF($5, ''), $6)
				ON CONFLICT (name_key) DO UPDATE SET name_key = EXCLUDED.name_key
				RETURNING id, name`, input.Name, key, input.Category, input.Website, input.Note, input.UserID).Scan(&result.ID, &result.Name); err != nil {
				return err
			}
		case err != nil:
			return err
		default:
			result.AlreadyRequested = true
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO catalog_request_votes (request_id, user_id, workspace_id) VALUES ($1, $2, $3)
			ON CONFLICT (request_id, user_id) DO NOTHING`, result.ID, input.UserID, input.WorkspaceID); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM catalog_request_votes WHERE request_id = $1`, result.ID).Scan(&result.Votes)
	})
	return result, err
}
