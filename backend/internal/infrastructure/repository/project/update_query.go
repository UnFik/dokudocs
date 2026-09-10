package project

import (
	"context"

	"backend/constant"
	"backend/internal/domain/model"
)

func (r *Repository) Update(ctx context.Context, p model.Project) error {
	const query = `
		UPDATE projects
		SET name = $2, description = $3, logo_url = $4, color_badge = $5, visibility = $6::project_visibility, updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`
	res, err := r.db.ExecContext(ctx, query, p.ID, p.Name, p.Description, p.LogoURL, p.ColorBadge, p.Visibility)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrProjectNotFound
	}
	return nil
}
