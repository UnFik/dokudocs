package document

import (
	"context"
	"database/sql"
	"encoding/json"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) ListDocumentRevisions(ctx context.Context, documentID, workspaceID, actorID uuid.UUID) ([]model.DocumentRevision, error) {
	revisions := make([]model.DocumentRevision, 0)
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT id, document_id, author_id, version_number, COALESCE(title, ''), content,
			       is_named, content_json, body_version, created_at, updated_at
			FROM document_revisions
			WHERE document_id = $1
			ORDER BY version_number DESC
		`, documentID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var revision model.DocumentRevision
			var snapshot []byte
			var bodyVersion sql.NullInt64
			if err := rows.Scan(
				&revision.ID, &revision.DocumentID, &revision.AuthorID, &revision.VersionNumber,
				&revision.Title, &revision.Content, &revision.IsNamed, &snapshot,
				&bodyVersion, &revision.CreatedAt, &revision.UpdatedAt,
			); err != nil {
				return err
			}
			if len(snapshot) > 0 {
				revision.ContentJSON = append(json.RawMessage(nil), snapshot...)
			}
			if bodyVersion.Valid {
				value := bodyVersion.Int64
				revision.BodyVersion = &value
			}
			revisions = append(revisions, revision)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return revisions, nil
}

func (r *Repository) CreateNamedDocumentRevision(ctx context.Context, documentID, workspaceID, actorID uuid.UUID, title string) (model.DocumentRevision, error) {
	var revision model.DocumentRevision
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		var content string
		var contentJSON []byte
		var bodyVersion int64
		if err := tx.QueryRowContext(ctx, `
			SELECT content, content_json, body_version
			FROM documents WHERE id = $1 AND workspace_id = $2
		`, documentID, workspaceID).Scan(&content, &contentJSON, &bodyVersion); err != nil {
			return err
		}
		revision = model.DocumentRevision{
			DocumentID: documentID, AuthorID: actorID, Title: title,
			Content: content, IsNamed: true, BodyVersion: &bodyVersion,
		}
		if len(contentJSON) > 0 {
			revision.ContentJSON = contentJSON
		}
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO document_revisions (
				document_id, author_id, version_number, title, content, is_named, content_json, body_version
			)
			SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3, $4, TRUE, $5::jsonb, $6
			FROM document_revisions WHERE document_id = $1
			RETURNING id, version_number, created_at, updated_at
		`, documentID, actorID, title, revision.Content, nullableJSON(contentJSON), bodyVersion).Scan(
			&revision.ID, &revision.VersionNumber, &revision.CreatedAt, &revision.UpdatedAt,
		); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return model.DocumentRevision{}, err
	}
	return revision, nil
}
