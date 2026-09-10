package project

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) AddCategory(ctx context.Context, cat model.ProjectCategory) (model.ProjectCategory, error) {
	if cat.ID == uuid.Nil {
		cat.ID = uuid.New()
	}
	if cat.ColorID == "" {
		cat.ColorID = "blue"
	}
	const query = `
		INSERT INTO project_categories (id, project_id, name, color_id, sort_order)
		VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM project_categories WHERE project_id = $2), 0))
		RETURNING sort_order, created_at
	`
	err := r.db.QueryRowContext(ctx, query, cat.ID, cat.ProjectID, cat.Name, cat.ColorID).Scan(&cat.SortOrder, &cat.CreatedAt)
	return cat, err
}
