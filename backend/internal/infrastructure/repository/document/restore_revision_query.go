package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

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

		var priorActor, priorSource uuid.UUID
		var priorBodyVersion, priorBodyEpoch sql.NullInt64
		var priorRevisionID uuid.UUID
		err = tx.QueryRowContext(ctx, `
			SELECT id, author_id, restore_source_revision_id, body_version, body_epoch
			FROM document_revisions
			WHERE document_id = $1 AND restore_request_id = $2
		`, documentID, requestID).Scan(
			&priorRevisionID, &priorActor, &priorSource, &priorBodyVersion, &priorBodyEpoch,
		)
		if err == nil {
			if priorActor != actorID || priorSource != sourceRevisionID || !priorBodyVersion.Valid || !priorBodyEpoch.Valid {
				return constant.ErrDocumentConflict
			}
			result = model.DocumentRestoreResult{
				DocumentID: documentID, RevisionID: priorRevisionID, SourceRevisionID: priorSource,
				BodyVersion: priorBodyVersion.Int64, BodyEpoch: priorBodyEpoch.Int64,
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		var sourceSnapshot []byte
		var sourceSchemaVersion sql.NullInt64
		var sourceRevisionNumber int
		if err := tx.QueryRowContext(ctx, `
			SELECT ast_snapshot, body_schema_version, version_number
			FROM document_revisions
			WHERE id = $1 AND document_id = $2
			FOR SHARE
		`, sourceRevisionID, documentID).Scan(
			&sourceSnapshot, &sourceSchemaVersion, &sourceRevisionNumber,
		); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if len(sourceSnapshot) == 0 || !sourceSchemaVersion.Valid || sourceSchemaVersion.Int64 != yjs.BodySchemaVersionV1 {
			return collaboration.ErrBodyNotInitialized
		}
		var restoredBody documentbody.Body
		if err := json.Unmarshal(sourceSnapshot, &restoredBody); err != nil {
			return fmt.Errorf("decode revision AST: %w", err)
		}
		if restoredBody.DocumentID != documentID || documentbody.Validate(restoredBody) != nil {
			return collaboration.ErrInvalidBodySnapshot
		}

		var currentRootText sql.NullString
		var documentType string
		var bodyVersion, bodyEpoch int64
		var bodySchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT type::text, root_node_id::text, body_version, body_epoch, body_schema_version
			FROM documents WHERE id = $1 AND workspace_id = $2
		`, documentID, workspaceID).Scan(
			&documentType, &currentRootText, &bodyVersion, &bodyEpoch, &bodySchemaVersion,
		); err != nil {
			return err
		}
		if documentType != "markdown" {
			return collaboration.ErrBodyNotInitialized
		}
		if !currentRootText.Valid {
			return collaboration.ErrBodyNotInitialized
		}
		if bodySchemaVersion != yjs.BodySchemaVersionV1 || bodySchemaVersion != int(sourceSchemaVersion.Int64) {
			return collaboration.ErrBodySchemaMismatch
		}
		if bodyVersion == math.MaxInt64 || bodyEpoch == math.MaxInt64 {
			return constant.ErrDocumentConflict
		}
		currentRootID, err := uuid.Parse(currentRootText.String)
		if err != nil {
			return err
		}
		currentBody, err := loadDocumentBody(ctx, tx, documentID, currentRootID)
		if err != nil {
			return err
		}
		var currentState []byte
		var stateSchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT encoded_state, schema_version FROM document_collab_states WHERE document_id = $1
		`, documentID).Scan(&currentState, &stateSchemaVersion); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return collaboration.ErrBodyNotInitialized
			}
			return err
		}
		if stateSchemaVersion != bodySchemaVersion {
			return collaboration.ErrBodySchemaMismatch
		}
		projected, err := yjs.ProjectV1(currentState, documentID)
		if err != nil {
			return err
		}
		if !documentbody.SameContent(currentBody, projected) {
			return constant.ErrDocumentConflict
		}

		if err := storeAutoRevision(ctx, tx, documentID, actorID, currentBody, bodyVersion, bodySchemaVersion, 0); err != nil {
			return err
		}
		newBodyVersion, newBodyEpoch := bodyVersion+1, bodyEpoch+1
		newState, err := yjs.EncodeBodyV1(restoredBody)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE comment_threads
			SET anchor_state = 'orphan', anchor_start = NULL, anchor_end = NULL
			WHERE document_id = $1 AND anchor_node_id IS NOT NULL
		`, documentID); err != nil {
			return err
		}
		if err := replaceDocumentBody(ctx, tx, documentID, restoredBody); err != nil {
			return err
		}
		updatedDocument, err := tx.ExecContext(ctx, `
			UPDATE documents
			SET root_node_id = $2, body_version = $3, body_epoch = $4, updated_at = NOW()
			WHERE id = $1 AND workspace_id = $5 AND root_node_id = $6
			  AND body_version = $7 AND body_epoch = $8
		`, documentID, restoredBody.RootNodeID, newBodyVersion, newBodyEpoch,
			workspaceID, currentRootID, bodyVersion, bodyEpoch)
		if err != nil {
			return err
		}
		if rows, err := updatedDocument.RowsAffected(); err != nil {
			return err
		} else if rows != 1 {
			return constant.ErrDocumentConflict
		}
		updatedState, err := tx.ExecContext(ctx, `
			UPDATE document_collab_states SET encoded_state = $2, updated_at = NOW()
			WHERE document_id = $1 AND schema_version = $3
		`, documentID, newState, bodySchemaVersion)
		if err != nil {
			return err
		}
		if rows, err := updatedState.RowsAffected(); err != nil {
			return err
		} else if rows != 1 {
			return collaboration.ErrBodyNotInitialized
		}

		var restoredRevision model.DocumentRevision
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO document_revisions (
				document_id, author_id, version_number, title, content, is_named,
				ast_snapshot, body_version, body_schema_version, restore_request_id,
				restore_source_revision_id, body_epoch
			)
			SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3, '', FALSE,
			       $4::jsonb, $5, $6, $7, $8, $9
			FROM document_revisions WHERE document_id = $1
			RETURNING id, version_number, created_at, updated_at
		`, documentID, actorID, fmt.Sprintf("Restored from v%d", sourceRevisionNumber), string(sourceSnapshot),
			newBodyVersion, bodySchemaVersion, requestID, sourceRevisionID, newBodyEpoch).Scan(
			&restoredRevision.ID, &restoredRevision.VersionNumber, &restoredRevision.CreatedAt, &restoredRevision.UpdatedAt,
		); err != nil {
			return err
		}
		result = model.DocumentRestoreResult{
			DocumentID: documentID, RevisionID: restoredRevision.ID, SourceRevisionID: sourceRevisionID,
			BodyVersion: newBodyVersion, BodyEpoch: newBodyEpoch,
		}
		return nil
	})
	if err != nil {
		return model.DocumentRestoreResult{}, err
	}
	return result, nil
}
