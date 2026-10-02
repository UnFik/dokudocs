package project

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) DeleteCategory(ctx context.Context, projectID, workspaceID, actorID, categoryID uuid.UUID) error {
	const query = `DELETE FROM project_categories WHERE id = $2 AND project_id = $1`
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockEditableProject(ctx, tx, projectID, workspaceID, actorID); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, query, projectID, categoryID)
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
		return nil
	})
}
