package document

import (
	"context"
	"database/sql"
	"errors"

	"backend/internal/application/collaboration"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

var _ collaboration.RevisionFlusher = (*Repository)(nil)

// FlushAutoRevision brings the rolling auto revision up to the document's
// current body. Collaborative commits rewrite that revision at most once per
// debounce, so after the last edit it can trail the body until the next
// commit; the server calls this once editing stops. It does nothing when the
// latest revision is named, a restore point, or already at the body version.
func (r *Repository) FlushAutoRevision(ctx context.Context, documentID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var rootID uuid.UUID
		var bodyVersion int64
		var schemaVersion int
		err := tx.QueryRowContext(ctx, `
			SELECT root_node_id, body_version, body_schema_version
			FROM documents
			WHERE id = $1 AND deleted_at IS NULL AND root_node_id IS NOT NULL
			FOR UPDATE
		`, documentID).Scan(&rootID, &bodyVersion, &schemaVersion)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		var authorID uuid.UUID
		var revisionVersion sql.NullInt64
		err = tx.QueryRowContext(ctx, `
			SELECT author_id, body_version
			FROM document_revisions
			WHERE document_id = $1
			ORDER BY version_number DESC
			LIMIT 1
		`, documentID).Scan(&authorID, &revisionVersion)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if !revisionVersion.Valid || revisionVersion.Int64 >= bodyVersion {
			return nil
		}
		body, err := loadDocumentBody(ctx, tx, documentID, rootID)
		if err != nil {
			return err
		}
		return storeAutoRevision(ctx, tx, documentID, authorID, body, bodyVersion, schemaVersion, 0)
	})
}
