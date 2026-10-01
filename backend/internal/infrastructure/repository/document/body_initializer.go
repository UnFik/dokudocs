package document

import (
	"context"
	"crypto/sha256"
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

var _ collaboration.BodyInitializer = (*Repository)(nil)

// InitializeBody imports a parsed legacy Markdown body once. The source hash
// and base version protect the import from racing an edit to documents.content.
func (r *Repository) InitializeBody(ctx context.Context, actor collaboration.Actor, input collaboration.BodyInitialization) error {
	if actor.UserID == uuid.Nil || input.WorkspaceID == uuid.Nil || input.DocumentID == uuid.Nil || input.BaseBodyVersion < 1 ||
		input.BodySchemaVersion != yjs.BodySchemaVersionV1 || input.Body.DocumentID != input.DocumentID {
		return collaboration.ErrInvalidBodyInitialization
	}
	encodedState, err := yjs.EncodeBodyV1(input.Body)
	if err != nil {
		return err
	}
	if r.tx == nil {
		return errors.New("body initialization requires a transaction-capable database")
	}

	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var workspaceID uuid.UUID
		if err := tx.QueryRowContext(ctx, `
			SELECT workspace_id FROM documents
			WHERE id = $1 AND workspace_id = $2 AND type = 'markdown' AND deleted_at IS NULL
		`, input.DocumentID, input.WorkspaceID).Scan(&workspaceID); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrDocumentNotFound
			}
			return err
		}
		doc, access, err := lockDocumentAccess(ctx, tx, input.DocumentID, workspaceID, actor.UserID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}

		var source string
		var rootIDText sql.NullString
		var bodyVersion int64
		var schemaVersion int
		if err := tx.QueryRowContext(ctx, `
			SELECT content, root_node_id::text, body_version, body_schema_version
			FROM documents WHERE id = $1 AND workspace_id = $2 AND type = 'markdown' AND deleted_at IS NULL
		`, input.DocumentID, workspaceID).Scan(&source, &rootIDText, &bodyVersion, &schemaVersion); err != nil {
			return err
		}
		if schemaVersion != input.BodySchemaVersion {
			return collaboration.ErrBodySchemaMismatch
		}

		if rootIDText.Valid {
			rootID, err := uuid.Parse(rootIDText.String)
			if err != nil {
				return err
			}
			persistedBody, err := loadDocumentBody(ctx, tx, input.DocumentID, rootID)
			if err != nil {
				return err
			}
			var persisted []byte
			var persistedSchema int
			if err := tx.QueryRowContext(ctx, `
				SELECT encoded_state, schema_version FROM document_collab_states WHERE document_id = $1
			`, input.DocumentID).Scan(&persisted, &persistedSchema); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return collaboration.ErrBodyNotInitialized
				}
				return err
			}
			if persistedSchema != input.BodySchemaVersion {
				return collaboration.ErrBodySchemaMismatch
			}
			projected, err := yjs.ProjectV1(persisted, input.DocumentID)
			if err != nil {
				return err
			}
			if !documentbody.SameContent(input.Body, persistedBody) || !documentbody.SameContent(persistedBody, projected) {
				return constant.ErrDocumentConflict
			}
			return nil
		}
		if bodyVersion != input.BaseBodyVersion || sha256.Sum256([]byte(source)) != input.SourceFingerprint {
			return constant.ErrDocumentConflict
		}

		var nodeCount, stateCount int
		if err := tx.QueryRowContext(ctx, `
			SELECT (SELECT COUNT(*) FROM document_nodes WHERE document_id = $1),
			       (SELECT COUNT(*) FROM document_collab_states WHERE document_id = $1)
		`, input.DocumentID).Scan(&nodeCount, &stateCount); err != nil {
			return err
		}
		if nodeCount != 0 || stateCount != 0 {
			return constant.ErrDocumentConflict
		}
		if err := insertDocumentNodes(ctx, tx, input.Body); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_collab_states (document_id, encoded_state, schema_version)
			VALUES ($1, $2, $3)
		`, input.DocumentID, encodedState, input.BodySchemaVersion); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE documents SET root_node_id = $2
			WHERE id = $1 AND workspace_id = $3 AND root_node_id IS NULL AND body_version = $4
		`, input.DocumentID, input.Body.RootNodeID, workspaceID, input.BaseBodyVersion)
		if err != nil {
			return err
		}
		rows, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if rows != 1 {
			return constant.ErrDocumentConflict
		}
		return storeAutoRevision(ctx, tx, input.DocumentID, actor.UserID, input.Body, bodyVersion, input.BodySchemaVersion, 0)
	})
}

func insertDocumentNodes(ctx context.Context, tx database.Queryer, body documentbody.Body) error {
	for _, node := range body.Nodes {
		var parentID any
		if node.ParentID != nil {
			parentID = *node.ParentID
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_nodes (document_id, node_id, parent_id, sibling_order, node_type, content, attributes, version)
			VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
		`, node.DocumentID, node.NodeID, parentID, node.SiblingOrder, node.Type, node.Content, string(node.Attributes), node.Version); err != nil {
			return err
		}
	}
	return nil
}
