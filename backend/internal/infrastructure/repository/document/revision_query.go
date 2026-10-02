package document

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/model"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/collaboration/yjs"
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
			       is_named, ast_snapshot, body_version, body_schema_version, created_at, updated_at
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
			var bodyVersion, bodySchemaVersion sql.NullInt64
			if err := rows.Scan(
				&revision.ID, &revision.DocumentID, &revision.AuthorID, &revision.VersionNumber,
				&revision.Title, &revision.Content, &revision.IsNamed, &snapshot,
				&bodyVersion, &bodySchemaVersion, &revision.CreatedAt, &revision.UpdatedAt,
			); err != nil {
				return err
			}
			if len(snapshot) > 0 {
				revision.ASTSnapshot = append(json.RawMessage(nil), snapshot...)
			}
			if bodyVersion.Valid {
				value := bodyVersion.Int64
				revision.BodyVersion = &value
			}
			if bodySchemaVersion.Valid {
				value := int(bodySchemaVersion.Int64)
				revision.BodySchemaVersion = &value
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
		var documentType string
		var content string
		var rootIDText sql.NullString
		var bodyVersion int64
		var bodySchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT type::text, content, root_node_id::text, body_version, body_schema_version
			FROM documents WHERE id = $1 AND workspace_id = $2
		`, documentID, workspaceID).Scan(&documentType, &content, &rootIDText, &bodyVersion, &bodySchemaVersion); err != nil {
			return err
		}
		revision = model.DocumentRevision{
			DocumentID: documentID, AuthorID: actorID, Title: title,
			Content: content, IsNamed: true,
		}
		var snapshot []byte
		if documentType == "markdown" {
			if !rootIDText.Valid {
				return collaboration.ErrBodyNotInitialized
			}
			if bodySchemaVersion != yjs.BodySchemaVersionV1 {
				return collaboration.ErrBodySchemaMismatch
			}
			rootID, err := uuid.Parse(rootIDText.String)
			if err != nil {
				return err
			}
			body, err := loadDocumentBody(ctx, tx, documentID, rootID)
			if err != nil {
				return err
			}
			var state []byte
			var stateSchemaVersion int
			if err := tx.QueryRowContext(ctx, `
				SELECT encoded_state, schema_version FROM document_collab_states WHERE document_id = $1
			`, documentID).Scan(&state, &stateSchemaVersion); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return collaboration.ErrBodyNotInitialized
				}
				return err
			}
			if stateSchemaVersion != bodySchemaVersion {
				return collaboration.ErrBodySchemaMismatch
			}
			projected, err := yjs.ProjectV1(state, documentID)
			if err != nil {
				return err
			}
			if !documentbody.SameContent(body, projected) {
				return constant.ErrDocumentConflict
			}
			snapshot, err = json.Marshal(body)
			if err != nil {
				return err
			}
			revision.Content = ""
			revision.ASTSnapshot = snapshot
			revision.BodyVersion = &bodyVersion
			revision.BodySchemaVersion = &bodySchemaVersion
		}
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO document_revisions (
				document_id, author_id, version_number, title, content, is_named,
				ast_snapshot, body_version, body_schema_version
			)
			SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3, $4, TRUE,
			       NULLIF($5, '')::jsonb, $6, $7
			FROM document_revisions WHERE document_id = $1
			RETURNING id, version_number, created_at, updated_at
		`, documentID, actorID, title, revision.Content, string(snapshot), revision.BodyVersion, revision.BodySchemaVersion).Scan(
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
