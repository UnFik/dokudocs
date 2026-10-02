package workspace

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) GetByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (model.Workspace, error) {
	const query = `
		SELECT w.id, w.name, w.slug, w.plan, COALESCE(w.logo_url, ''),
		       COALESCE(wm.role::text, ''), w.created_by, w.created_at, w.updated_at
		FROM workspaces w
		JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = $2
		WHERE w.id = $1
	`
	var w model.Workspace
	err := r.db.QueryRowContext(ctx, query, id, userID).Scan(
		&w.ID, &w.Name, &w.Slug, &w.Plan, &w.LogoURL,
		&w.Role, &w.CreatedBy, &w.CreatedAt, &w.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return w, constant.ErrWorkspaceNotFound
	}
	return w, err
}
