package project

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) ReorderCategories(ctx context.Context, projectID uuid.UUID, categoryIDs []uuid.UUID) error {
	const query = `UPDATE project_categories SET sort_order = $3 WHERE id = $1 AND project_id = $2`
	for i, id := range categoryIDs {
		if _, err := r.db.ExecContext(ctx, query, id, projectID, i); err != nil {
			return err
		}
	}
	return nil
}
