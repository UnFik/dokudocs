package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) DuplicateAuthorized(ctx context.Context, docID, workspaceID, actorID, requestID uuid.UUID) (model.Document, error) {
	if requestID == uuid.Nil {
		return model.Document{}, constant.ErrInvalidIdempotencyKey
	}
	duplicateID := uuid.New()
	requestHash := duplicateRequestHash(workspaceID, docID)
	var replayID uuid.UUID
	err := r.withReadableDocumentPlacement(ctx, docID, workspaceID, actorID, true, func(tx database.Queryer) error {
		var existingHash []byte
		err := tx.QueryRowContext(ctx, `
			SELECT id, creation_request_hash FROM documents
			WHERE author_id = $1 AND creation_request_kind = 'duplicate' AND creation_request_id = $2
		`, actorID, requestID).Scan(&replayID, &existingHash)
		if err == nil {
			if !bytes.Equal(existingHash, requestHash[:]) {
				return constant.ErrDocumentConflict
			}
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		var documentType string
		var rootIDText sql.NullString
		var bodySchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT type::text, root_node_id::text, body_schema_version
			FROM documents WHERE id = $1 AND workspace_id = $2
		`, docID, workspaceID).Scan(&documentType, &rootIDText, &bodySchemaVersion); err != nil {
			return err
		}
		var duplicateBody *documentbody.Body
		var duplicateState []byte
		if rootIDText.Valid {
			if documentType != "markdown" || bodySchemaVersion != yjs.BodySchemaVersionV1 {
				return collaboration.ErrBodySchemaMismatch
			}
			rootID, err := uuid.Parse(rootIDText.String)
			if err != nil {
				return err
			}
			sourceBody, err := loadDocumentBody(ctx, tx, docID, rootID)
			if err != nil {
				return err
			}
			var sourceState []byte
			var stateSchemaVersion int
			if err := tx.QueryRowContext(ctx, `
				SELECT encoded_state, schema_version FROM document_collab_states WHERE document_id = $1
				`, docID).Scan(&sourceState, &stateSchemaVersion); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return collaboration.ErrBodyNotInitialized
				}
				return err
			}
			if stateSchemaVersion != bodySchemaVersion {
				return collaboration.ErrBodySchemaMismatch
			}
			projected, err := yjs.ProjectV1(sourceState, docID)
			if err != nil {
				return err
			}
			if err := setNodeVersions(sourceBody, &projected); err != nil {
				return err
			}
			if !sameBody(sourceBody, projected) {
				return constant.ErrDocumentConflict
			}
			copiedBody, err := documentbody.CloneForDocument(sourceBody, duplicateID)
			if err != nil {
				return err
			}
			duplicateState, err = yjs.EncodeBodyV1(copiedBody)
			if err != nil {
				return err
			}
			duplicateBody = &copiedBody
		}

		var projectID sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT project_id::text FROM documents WHERE id = $1`, docID).Scan(&projectID); err != nil {
			return err
		}
		if projectID.Valid {
			id, err := uuid.Parse(projectID.String)
			if err != nil {
				return err
			}
			var lockedID uuid.UUID
			err = tx.QueryRowContext(ctx, `
				SELECT id FROM projects
				WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
				FOR SHARE
			`, id, workspaceID).Scan(&lockedID)
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrProjectNotFound
			}
			if err != nil {
				return err
			}
		}

		err = tx.QueryRowContext(ctx, `
			INSERT INTO documents (
				id, workspace_id, project_id, title, type, content, author_id, tags, is_draft, visibility,
				creation_request_kind, creation_request_id, creation_request_hash
			)
			SELECT $1, d.workspace_id, d.project_id, 'Copy of ' || d.title, d.type,
			       CASE WHEN d.type = 'markdown' AND d.root_node_id IS NOT NULL THEN '' ELSE d.content END,
			       $2, d.tags, d.is_draft, d.visibility, 'duplicate', $5, $6
			FROM documents d
			WHERE d.id = $3 AND d.workspace_id = $4 AND d.deleted_at IS NULL
			ON CONFLICT (author_id, creation_request_kind, creation_request_id)
			WHERE creation_request_id IS NOT NULL DO NOTHING
			RETURNING id
		`, duplicateID, actorID, docID, workspaceID, requestID, requestHash[:]).Scan(&duplicateID)
		if errors.Is(err, sql.ErrNoRows) {
			err = tx.QueryRowContext(ctx, `
				SELECT id, creation_request_hash FROM documents
				WHERE author_id = $1 AND creation_request_kind = 'duplicate' AND creation_request_id = $2
			`, actorID, requestID).Scan(&replayID, &existingHash)
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentConflict
			}
			if err != nil {
				return err
			}
			if !bytes.Equal(existingHash, requestHash[:]) {
				return constant.ErrDocumentConflict
			}
			return nil
		}
		if err != nil {
			return err
		}
		if duplicateID == uuid.Nil {
			return constant.ErrDocumentNotFound
		}
		if duplicateBody != nil {
			if err := insertDocumentNodes(ctx, tx, *duplicateBody); err != nil {
				return err
			}
			result, err := tx.ExecContext(ctx, `
				UPDATE documents SET root_node_id = $2, body_version = 1, body_epoch = 1, body_schema_version = $3
				WHERE id = $1 AND workspace_id = $4
			`, duplicateID, duplicateBody.RootNodeID, yjs.BodySchemaVersionV1, workspaceID)
			if err != nil {
				return err
			}
			if rows, err := result.RowsAffected(); err != nil {
				return err
			} else if rows != 1 {
				return constant.ErrDocumentConflict
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO document_collab_states (document_id, encoded_state, schema_version)
				VALUES ($1, $2, $3)
			`, duplicateID, duplicateState, yjs.BodySchemaVersionV1); err != nil {
				return err
			}
			if err := storeAutoRevision(ctx, tx, duplicateID, actorID, *duplicateBody, 1, yjs.BodySchemaVersionV1, 0); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_category_mappings (document_id, category_id)
			SELECT $1, category_id FROM document_category_mappings WHERE document_id = $2
			ON CONFLICT DO NOTHING
		`, duplicateID, docID); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO document_accesses (document_id, user_id, access_level)
			VALUES ($1, $2, 'owner'::document_access_level)
		`, duplicateID, actorID)
		return err
	})
	if err != nil {
		return model.Document{}, err
	}
	if replayID != uuid.Nil {
		duplicateID = replayID
	}
	return r.GetByID(ctx, duplicateID, actorID)
}

func duplicateRequestHash(workspaceID, sourceDocumentID uuid.UUID) [32]byte {
	payload := append([]byte("duplicate:"), workspaceID[:]...)
	payload = append(payload, sourceDocumentID[:]...)
	return sha256.Sum256(payload)
}
