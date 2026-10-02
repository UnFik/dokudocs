package project

import (
	"context"

	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) AddCategory(ctx context.Context, cat model.ProjectCategory, workspaceID, actorID uuid.UUID) (model.ProjectCategory, error) {
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
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockEditableProject(ctx, tx, cat.ProjectID, workspaceID, actorID); err != nil {
			return err
		}
		return tx.QueryRowContext(ctx, query, cat.ID, cat.ProjectID, cat.Name, cat.ColorID).Scan(&cat.SortOrder, &cat.CreatedAt)
	})
	return cat, err
}
