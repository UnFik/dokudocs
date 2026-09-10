package project

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) UpdateCategory(ctx context.Context, projectID, categoryID uuid.UUID, name, colorID string) error {
	const query = `
		UPDATE project_categories
		SET name = COALESCE(NULLIF($3, ''), name),
		    color_id = COALESCE(NULLIF($4, ''), color_id)
		WHERE id = $2 AND project_id = $1
	`
	res, err := r.db.ExecContext(ctx, query, projectID, categoryID, name, colorID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrCategoryNotFound
	}
	return nil
}
