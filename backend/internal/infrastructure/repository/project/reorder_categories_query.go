package project

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) ReorderCategories(ctx context.Context, projectID, workspaceID, actorID uuid.UUID, categoryIDs []uuid.UUID) error {
	const query = `UPDATE project_categories SET sort_order = $3 WHERE id = $1 AND project_id = $2`
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockEditableProject(ctx, tx, projectID, workspaceID, actorID); err != nil {
			return err
		}
		for i, id := range categoryIDs {
			res, err := tx.ExecContext(ctx, query, id, projectID, i)
			if err != nil {
				return err
			}
			rows, err := res.RowsAffected()
			if err != nil {
				return err
			}
			if rows == 0 {
				return constant.ErrCategoryNotFound
			}
		}
		return nil
	})
}
