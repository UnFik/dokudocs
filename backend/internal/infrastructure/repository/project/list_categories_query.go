package project

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) ListCategories(ctx context.Context, projectID, workspaceID, userID uuid.UUID) ([]model.ProjectCategory, error) {
	query := `
		SELECT c.id, c.project_id, c.name, c.color_id, c.sort_order, c.created_at
		FROM project_categories c
	JOIN projects p ON p.id = c.project_id
		WHERE c.project_id = $1 AND p.workspace_id = $2 AND p.deleted_at IS NULL
		  AND ` + projectReadAccessPredicate("$3") + `
		ORDER BY c.sort_order ASC, c.created_at ASC
	`
	rows, err := r.db.QueryContext(ctx, query, projectID, workspaceID, userID)
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
