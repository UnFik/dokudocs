package project

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) SoftDelete(ctx context.Context, id, workspaceID, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockManagedProject(ctx, tx, id, workspaceID, actorID); err != nil {
			return err
		}
		const query = `UPDATE projects SET deleted_at = NOW() WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`
		res, err := tx.ExecContext(ctx, query, id, workspaceID)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrProjectNotFound
		}
		return nil
	})
}
