package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/domain/model"
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
				creation_request_kind, creation_request_id, creation_request_hash, content_json
			)
			SELECT $1, d.workspace_id, d.project_id, 'Copy of ' || d.title, d.type,
			       d.content,
			       $2, d.tags, d.is_draft, d.visibility, 'duplicate', $5, $6, d.content_json
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
