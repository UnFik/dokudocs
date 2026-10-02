package document

import (
	"context"
	"fmt"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) SoftDelete(ctx context.Context, id, workspaceID, actorID uuid.UUID) error {
	if r.tx == nil {
		return fmt.Errorf("document trash requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, id, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE documents SET deleted_at = NOW(), deleted_by = $3
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		`, id, workspaceID, actorID)
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
		return nil
	})
}
