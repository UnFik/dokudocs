package document

import (
	"context"
	"fmt"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) Restore(ctx context.Context, id, workspaceID, actorID uuid.UUID) error {
	if r.tx == nil {
		return fmt.Errorf("document restore requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, id, workspaceID, actorID, true, nil)
		if err != nil {
			return err
		}
		if !policy.CanRestoreDocument(doc, access) {
			return constant.ErrForbidden
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE documents SET deleted_at = NULL, deleted_by = NULL
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NOT NULL
		`, id, workspaceID)
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
