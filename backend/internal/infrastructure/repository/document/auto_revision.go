package document

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// storeAutoRevision keeps one rolling unnamed revision per ten-minute window.
// Within a window the snapshot is rewritten at most once per debounce; a zero
// debounce rewrites it on every call.
func storeAutoRevision(ctx context.Context, tx database.Queryer, documentID, authorID uuid.UUID, markdown string, contentJSON []byte, bodyVersion int64, debounce time.Duration) error {
	var revisionID uuid.UUID
	var isNamed, hasJSON, isRestore, withinWindow, recent bool
	err := tx.QueryRowContext(ctx, `
		SELECT id, is_named, content_json IS NOT NULL, restore_request_id IS NOT NULL,
		       updated_at >= NOW() - INTERVAL '10 minutes',
		       updated_at >= NOW() - make_interval(secs => $2)
		FROM document_revisions
		WHERE document_id = $1
		ORDER BY version_number DESC
		LIMIT 1
		FOR UPDATE
	`, documentID, debounce.Seconds()).Scan(&revisionID, &isNamed, &hasJSON, &isRestore, &withinWindow, &recent)
	rolling := err == nil && !isNamed && hasJSON && !isRestore && withinWindow
	if rolling && debounce > 0 && recent {
		return nil
	}
	if err == nil {
		if rolling {
			_, err = tx.ExecContext(ctx, `
				UPDATE document_revisions
				SET content = $2, content_json = $3::jsonb, body_version = $4, updated_at = NOW()
				WHERE id = $1
			`, revisionID, markdown, string(contentJSON), bodyVersion)
			return err
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO document_revisions (document_id, author_id, version_number, content, is_named, content_json, body_version)
		SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3, FALSE, $4::jsonb, $5
		FROM document_revisions WHERE document_id = $1
	`, documentID, authorID, markdown, string(contentJSON), bodyVersion)
	return err
}
