package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"backend/internal/domain/documentbody"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// storeAutoRevision keeps one rolling unnamed revision per ten-minute window.
// Within a window the snapshot is rewritten at most once per debounce, which
// saves marshalling and writing the whole body on every keystroke; the rolling
// revision can therefore trail the live body by up to the debounce. A zero
// debounce rewrites it on every call.
func storeAutoRevision(ctx context.Context, tx database.Queryer, documentID, authorID uuid.UUID, body documentbody.Body, bodyVersion int64, schemaVersion int, debounce time.Duration) error {
	var revisionID uuid.UUID
	var isNamed, hasAST, isRestore, withinWindow, recent bool
	err := tx.QueryRowContext(ctx, `
		SELECT id, is_named, ast_snapshot IS NOT NULL, restore_request_id IS NOT NULL,
		       updated_at >= NOW() - INTERVAL '10 minutes',
		       updated_at >= NOW() - make_interval(secs => $2)
		FROM document_revisions
		WHERE document_id = $1
		ORDER BY version_number DESC
		LIMIT 1
		FOR UPDATE
	`, documentID, debounce.Seconds()).Scan(&revisionID, &isNamed, &hasAST, &isRestore, &withinWindow, &recent)
	rolling := err == nil && !isNamed && hasAST && !isRestore && withinWindow
	if rolling && debounce > 0 && recent {
		return nil
	}
	snapshot, marshalErr := json.Marshal(body)
	if marshalErr != nil {
		return marshalErr
	}
	if err == nil {
		if rolling {
			_, err = tx.ExecContext(ctx, `
				UPDATE document_revisions
				SET ast_snapshot = $2::jsonb, body_version = $3, body_schema_version = $4, updated_at = NOW()
				WHERE id = $1
			`, revisionID, string(snapshot), bodyVersion, schemaVersion)
			return err
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO document_revisions (
			document_id, author_id, version_number, content, is_named,
			ast_snapshot, body_version, body_schema_version
		)
		SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, '', FALSE,
		       $3::jsonb, $4, $5
		FROM document_revisions WHERE document_id = $1
	`, documentID, authorID, string(snapshot), bodyVersion, schemaVersion)
	return err
}
