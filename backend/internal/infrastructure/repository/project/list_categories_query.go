package project

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) ListCategories(ctx context.Context, projectID uuid.UUID) ([]model.ProjectCategory, error) {
	const query = `
		SELECT id, project_id, name, color_id, sort_order, created_at
		FROM project_categories
		WHERE project_id = $1
		ORDER BY sort_order ASC, created_at ASC
	`
	rows, err := r.db.QueryContext(ctx, query, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cats := make([]model.ProjectCategory, 0)
	for rows.Next() {
		var c model.ProjectCategory
		if err := rows.Scan(&c.ID, &c.ProjectID, &c.Name, &c.ColorID, &c.SortOrder, &c.CreatedAt); err != nil {
			return nil, err
		}
		cats = append(cats, c)
	}
	return cats, rows.Err()
}
