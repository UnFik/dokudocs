package document

import (
	"context"
	"fmt"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) Move(ctx context.Context, id, workspaceID, actorID uuid.UUID, targetProjectID *uuid.UUID) error {
	if r.tx == nil {
		return fmt.Errorf("document move requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, id, workspaceID, actorID, false, targetProjectID)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE documents SET project_id = $3, updated_at = NOW()
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		`, id, workspaceID, targetProjectID)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrDocumentNotFound
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM document_category_mappings WHERE document_id = $1`, id)
		return err
	})
}
