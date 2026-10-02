package project

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) UpdateCategory(ctx context.Context, projectID, workspaceID, actorID, categoryID uuid.UUID, name, colorID string) error {
	const query = `
		UPDATE project_categories
		SET name = COALESCE(NULLIF($3, ''), name),
		    color_id = COALESCE(NULLIF($4, ''), color_id)
		WHERE id = $2 AND project_id = $1
	`
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockEditableProject(ctx, tx, projectID, workspaceID, actorID); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, query, projectID, categoryID, name, colorID)
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
