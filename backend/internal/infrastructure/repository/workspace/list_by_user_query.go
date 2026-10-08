package workspace

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) ListByUser(ctx context.Context, userID uuid.UUID) ([]model.Workspace, error) {
	const query = `
		SELECT w.id, w.name, w.slug, w.plan, COALESCE(w.logo_url, ''),
		       wm.role::text, w.created_by, w.created_at, w.updated_at
		FROM workspaces w
		JOIN workspace_members wm ON wm.workspace_id = w.id
		WHERE wm.user_id = $1
		ORDER BY w.created_at ASC
	`
	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := make([]model.Workspace, 0)
	for rows.Next() {
		var w model.Workspace
		if err := rows.Scan(
			&w.ID, &w.Name, &w.Slug, &w.Plan, &w.LogoURL,
			&w.Role, &w.CreatedBy, &w.CreatedAt, &w.UpdatedAt,
		); err != nil {
			return nil, err
		}
		list = append(list, w)
	}
	return list, rows.Err()
}
