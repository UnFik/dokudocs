// Package catalog keeps the Architecture catalog and the requests for missing entries.
package catalog

import (
	"context"
	"database/sql"
	"errors"

	appcatalog "backend/internal/application/catalog"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
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

func isPlatformAdmin(ctx context.Context, q database.Queryer, userID uuid.UUID) (bool, error) {
	var admin bool
	err := q.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
		               WHERE ur.user_id = $1 AND r.slug IN ('superadmin', 'admin'))`, userID).Scan(&admin)
	return admin, err
}

func (s *Store) OpenRequests(ctx context.Context, actorID uuid.UUID) ([]appcatalog.OpenRequest, error) {
	admin, err := isPlatformAdmin(ctx, s.db, actorID)
	if err != nil {
		return nil, err
	}
	if !admin {
		return nil, appcatalog.ErrNotAdmin
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id, r.name, r.category::text, COALESCE(r.website, ''), COALESCE(r.note, ''), COUNT(v.user_id), r.created_at
		FROM catalog_requests r LEFT JOIN catalog_request_votes v ON v.request_id = r.id
		WHERE r.status = 'open'
		GROUP BY r.id
		ORDER BY COUNT(v.user_id) DESC, r.created_at
		LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	open := []appcatalog.OpenRequest{}
	for rows.Next() {
		var r appcatalog.OpenRequest
		if err := rows.Scan(&r.ID, &r.Name, &r.Category, &r.Website, &r.Note, &r.Votes, &r.CreatedAt); err != nil {
			return nil, err
		}
		open = append(open, r)
	}
	return open, rows.Err()
}

func (s *Store) MyRequests(ctx context.Context, userID uuid.UUID) ([]appcatalog.MyRequest, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id, r.name, r.status, r.resolved_slug, COALESCE(r.decline_reason, ''),
		       (SELECT COUNT(*) FROM catalog_request_votes c WHERE c.request_id = r.id)
		FROM catalog_requests r JOIN catalog_request_votes v ON v.request_id = r.id AND v.user_id = $1
		ORDER BY r.created_at DESC
		LIMIT 100`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	mine := []appcatalog.MyRequest{}
	for rows.Next() {
		var r appcatalog.MyRequest
		var slug sql.NullString
		if err := rows.Scan(&r.ID, &r.Name, &r.Status, &slug, &r.DeclineReason, &r.Votes); err != nil {
			return nil, err
		}
		if slug.Valid {
			r.ResolvedSlug = &slug.String
		}
		mine = append(mine, r)
	}
	return mine, rows.Err()
}

// AnswerRequest closes an open request and tells every person who asked for it.
func (s *Store) AnswerRequest(ctx context.Context, actorID, requestID uuid.UUID, answer appcatalog.Answer) error {
	return s.db.WithTransaction(ctx, func(tx database.Queryer) error {
		admin, err := isPlatformAdmin(ctx, tx, actorID)
		if err != nil {
			return err
		}
		if !admin {
			return appcatalog.ErrNotAdmin
		}
		var name string
		var slug any
		if answer.Status == "added" {
			slug = answer.Slug
		}
		err = tx.QueryRowContext(ctx, `
			UPDATE catalog_requests SET status = $2, resolved_slug = $3, decline_reason = NULLIF($4, ''), resolved_at = NOW()
			WHERE id = $1 RETURNING name`, requestID, answer.Status, slug, answer.Reason).Scan(&name)
		if errors.Is(err, sql.ErrNoRows) {
			return appcatalog.ErrInvalidAnswer
		}
		if err != nil {
			return err
		}
		title := "“" + name + "” is in the catalog"
		body := "Search the palette for it, or change a generic Service to it from the properties panel."
		if answer.Status == "declined" {
			title = "“" + name + "” will not be added to the catalog"
			body = answer.Reason
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO notifications (user_id, kind, title, body)
			SELECT v.user_id, 'catalog_request', $2, $3 FROM catalog_request_votes v WHERE v.request_id = $1`, requestID, title, body)
		return err
	})
}

func (s *Store) Notifications(ctx context.Context, userID uuid.UUID) ([]appcatalog.Notification, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, kind, title, body, read_at IS NOT NULL, created_at,
			CASE WHEN document_id IS NULL THEN '' ELSE
				'/docs/' || document_id || '?workspaceId=' || workspace_id ||
				CASE WHEN thread_id IS NULL THEN '' ELSE '&thread=' || thread_id END
			END
		FROM notifications
		WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	notes := []appcatalog.Notification{}
	for rows.Next() {
		var n appcatalog.Notification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.Read, &n.CreatedAt, &n.Path); err != nil {
			return nil, err
		}
		notes = append(notes, n)
	}
	return notes, rows.Err()
}

func (s *Store) MarkNotificationsRead(ctx context.Context, userID uuid.UUID, kind string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE notifications SET read_at = NOW()
		WHERE user_id = $1 AND read_at IS NULL AND ($2 = '' OR kind = $2)`, userID, kind)
	return err
}
