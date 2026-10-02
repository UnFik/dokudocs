package document

import (
	"context"
	"fmt"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) SetShareToken(ctx context.Context, docID, workspaceID, actorID uuid.UUID, token, visibility string) (string, error) {
	if r.tx == nil {
		return "", fmt.Errorf("share token update requires a transaction-capable database")
	}
	var shareToken string
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, docID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		if visibility == "public_link" && doc.Visibility == "public_link" {
			if err := tx.QueryRowContext(ctx, `
				SELECT COALESCE(share_token, '') FROM documents WHERE id = $1 AND workspace_id = $2
			`, docID, workspaceID).Scan(&shareToken); err != nil {
				return err
			}
			if shareToken != "" {
				return nil
			}
		}
		return tx.QueryRowContext(ctx, `
			UPDATE documents
			SET share_token = $3, visibility = $4::document_visibility, updated_at = NOW()
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
			RETURNING share_token
		`, docID, workspaceID, token, visibility).Scan(&shareToken)
	})
	return shareToken, err
}
