package document

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/application/collaboration"
	"backend/internal/domain/documentbody"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/collaboration/yjs"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

var _ collaboration.BodyReader = (*Repository)(nil)

func (r *Repository) ReadBody(ctx context.Context, actor collaboration.Actor, workspaceID, documentID uuid.UUID) (collaboration.BodySnapshot, error) {
	var snapshot collaboration.BodySnapshot
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, documentID, workspaceID, actor.UserID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanReadDocument(doc, access) {
			return constant.ErrDocumentNotFound
		}
		snapshot.CanEdit = policy.CanEditDocument(doc, access)
		snapshot.CanSuggest = policy.CanSuggest(doc, access)
		var rootIDText sql.NullString
		var documentType string
		if err := tx.QueryRowContext(ctx, `
			SELECT root_node_id::text, type::text, body_version, body_epoch, body_schema_version
			FROM documents
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		`, documentID, workspaceID).Scan(
			&rootIDText, &documentType, &snapshot.BodyVersion, &snapshot.BodyEpoch, &snapshot.BodySchemaVersion,
		); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if documentType != "markdown" {
			return constant.ErrDocumentNotFound
		}
		if snapshot.BodySchemaVersion != yjs.BodySchemaVersionV1 {
			return collaboration.ErrBodySchemaMismatch
		}
		if !rootIDText.Valid {
			return collaboration.ErrBodyNotInitialized
		}
		rootID, err := uuid.Parse(rootIDText.String)
		if err != nil {
			return err
		}
		body, err := loadDocumentBody(ctx, tx, documentID, rootID)
		if err != nil {
			return err
		}
		var stateSchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT encoded_state, schema_version FROM document_collab_states WHERE document_id = $1
		`, documentID).Scan(&snapshot.EncodedState, &stateSchemaVersion); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return collaboration.ErrBodyNotInitialized
			}
			return err
		}
		if stateSchemaVersion != snapshot.BodySchemaVersion {
			return collaboration.ErrBodySchemaMismatch
		}
		projected, err := yjs.ProjectV1(snapshot.EncodedState, documentID)
		if err != nil {
			return err
		}
		if !documentbody.SameContent(body, projected) {
			return constant.ErrDocumentConflict
		}
		snapshot.Body = body
		return nil
	})
	if err != nil {
		return collaboration.BodySnapshot{}, err
	}
	snapshot.EncodedState = append([]byte(nil), snapshot.EncodedState...)
	return snapshot, nil
}

func (r *Repository) ReadPublicBody(ctx context.Context, shareToken string) (collaboration.PublicBodySnapshot, error) {
	var snapshot collaboration.PublicBodySnapshot
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var rootIDText sql.NullString
		var documentID uuid.UUID
		var documentType string
		if err := tx.QueryRowContext(ctx, `
			SELECT id, root_node_id::text, body_version, body_schema_version, type::text
			FROM documents
			WHERE share_token = $1
			  AND visibility = 'public_link'
			  AND is_draft = FALSE
			  AND deleted_at IS NULL
			FOR SHARE
		`, shareToken).Scan(
			&documentID, &rootIDText, &snapshot.BodyVersion, &snapshot.BodySchemaVersion, &documentType,
		); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		if documentType != "markdown" {
			return constant.ErrDocumentNotFound
		}
		if snapshot.BodySchemaVersion != yjs.BodySchemaVersionV1 {
			return collaboration.ErrBodySchemaMismatch
		}
		if !rootIDText.Valid {
			return collaboration.ErrBodyNotInitialized
		}
		rootID, err := uuid.Parse(rootIDText.String)
		if err != nil {
			return err
		}
		body, err := loadDocumentBody(ctx, tx, documentID, rootID)
		if err != nil {
			return err
		}
		var encodedState []byte
		var stateSchemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT encoded_state, schema_version FROM document_collab_states WHERE document_id = $1
		`, documentID).Scan(&encodedState, &stateSchemaVersion); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return collaboration.ErrBodyNotInitialized
			}
			return err
		}
		if stateSchemaVersion != snapshot.BodySchemaVersion {
			return collaboration.ErrBodySchemaMismatch
		}
		projected, err := yjs.ProjectV1(encodedState, documentID)
		if err != nil {
			return err
		}
		if !documentbody.SameContent(body, projected) {
			return constant.ErrDocumentConflict
		}
		snapshot.Body = body
		return nil
	})
	if err != nil {
		return collaboration.PublicBodySnapshot{}, err
	}
	return snapshot, nil
}
