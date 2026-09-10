package project

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) DeleteCategory(ctx context.Context, projectID, categoryID uuid.UUID) error {
	const query = `DELETE FROM project_categories WHERE id = $2 AND project_id = $1`
	res, err := r.db.ExecContext(ctx, query, projectID, categoryID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrCategoryNotFound
	}
	return nil
}
