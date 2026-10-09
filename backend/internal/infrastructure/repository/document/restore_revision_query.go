package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// RestoreDocumentRevision makes a revision the document again. It writes the
// revision's JSON and Markdown and drops the Yjs state: the collaboration
// service builds a new state from the JSON the next time the room opens, and
// the caller tells it to close the room that is open now. The document gets a
// new replacement id, so a room or a device copy of the old record cannot write
// over the restored one.
func (r *Repository) RestoreDocumentRevision(ctx context.Context, documentID, sourceRevisionID, workspaceID, actorID, requestID uuid.UUID) (model.DocumentRestoreResult, error) {
	if requestID == uuid.Nil {
		return model.DocumentRestoreResult{}, constant.ErrInvalidIdempotencyKey
	}
	var result model.DocumentRestoreResult
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}

		var priorActor, priorSource, priorRevisionID uuid.UUID
		var priorBodyVersion sql.NullInt64
		var priorReplacementID uuid.NullUUID
		err = tx.QueryRowContext(ctx, `
			SELECT id, author_id, restore_source_revision_id, body_version, restore_replacement_id
			FROM document_revisions
			WHERE document_id = $1 AND restore_request_id = $2
		`, documentID, requestID).Scan(&priorRevisionID, &priorActor, &priorSource, &priorBodyVersion, &priorReplacementID)
		if err == nil {
			if priorActor != actorID || priorSource != sourceRevisionID || !priorBodyVersion.Valid {
				return constant.ErrDocumentConflict
			}
			result = model.DocumentRestoreResult{
				DocumentID: documentID, RevisionID: priorRevisionID, SourceRevisionID: priorSource,
				BodyVersion: priorBodyVersion.Int64, ReplacementID: priorReplacementID.UUID,
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		var sourceMarkdown string
		var sourceJSON []byte
		var sourceRevisionNumber int
		if err := tx.QueryRowContext(ctx, `
			SELECT content, content_json, version_number
			FROM document_revisions
			WHERE id = $1 AND document_id = $2
			FOR SHARE
		`, sourceRevisionID, documentID).Scan(&sourceMarkdown, &sourceJSON, &sourceRevisionNumber); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}

		var documentType, currentMarkdown string
		var currentJSON []byte
		var bodyVersion int64
		if err := tx.QueryRowContext(ctx, `
			SELECT type::text, content, content_json, body_version
			FROM documents WHERE id = $1 AND workspace_id = $2
		`, documentID, workspaceID).Scan(&documentType, &currentMarkdown, &currentJSON, &bodyVersion); err != nil {
			return err
		}
		if !hasCollabBody(documentType) || len(sourceJSON) == 0 {
			return constant.ErrDocumentConflict
		}
		if bodyVersion == math.MaxInt64 {
			return constant.ErrDocumentConflict
		}
		if len(currentJSON) > 0 {
			if err := storeAutoRevision(ctx, tx, documentID, actorID, currentMarkdown, currentJSON, bodyVersion, 0); err != nil {
				return err
			}
		}
		newBodyVersion := bodyVersion + 1
		if _, err := tx.ExecContext(ctx, `
			UPDATE comment_threads
			SET anchor_state = 'orphan', anchor_start = NULL, anchor_end = NULL
			WHERE document_id = $1 AND anchor_node_id IS NOT NULL
		`, documentID); err != nil {
			return err
		}
		var replacementID uuid.UUID
		if err := tx.QueryRowContext(ctx, `
			UPDATE documents
			SET content = $2, content_json = $3::jsonb, body_version = $4, updated_at = NOW(),
			    body_replacement_id = gen_random_uuid()
			WHERE id = $1 AND workspace_id = $5
			RETURNING body_replacement_id
		`, documentID, sourceMarkdown, string(sourceJSON), newBodyVersion, workspaceID).Scan(&replacementID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM document_collab_states WHERE document_id = $1`, documentID); err != nil {
			return err
		}
		if documentType == "architecture" {
			if err := projectArchitectureLinks(ctx, tx, workspaceID, documentID, sourceJSON); err != nil {
				return err
			}
		}

		var restoredRevision model.DocumentRevision
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO document_revisions (
				document_id, author_id, version_number, title, content, is_named,
				content_json, body_version, restore_request_id, restore_source_revision_id, restore_replacement_id
			)
			SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3, $4, FALSE, $5::jsonb, $6, $7, $8, $9
			FROM document_revisions WHERE document_id = $1
			RETURNING id, version_number, created_at, updated_at
		`, documentID, actorID, fmt.Sprintf("Restored from v%d", sourceRevisionNumber), sourceMarkdown, string(sourceJSON),
			newBodyVersion, requestID, sourceRevisionID, replacementID).Scan(
			&restoredRevision.ID, &restoredRevision.VersionNumber, &restoredRevision.CreatedAt, &restoredRevision.UpdatedAt,
		); err != nil {
			return err
		}
		result = model.DocumentRestoreResult{
			DocumentID: documentID, RevisionID: restoredRevision.ID, SourceRevisionID: sourceRevisionID,
			BodyVersion: newBodyVersion, ReplacementID: replacementID,
		}
		return nil
	})
	if err != nil {
		return model.DocumentRestoreResult{}, err
	}
	return result, nil
}
