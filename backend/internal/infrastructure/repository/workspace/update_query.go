package workspace

import (
	"context"

	"backend/constant"
	"backend/internal/domain/model"
)

func (r *Repository) Update(ctx context.Context, ws model.Workspace) error {
	const query = `
		UPDATE workspaces
		SET name = $2, plan = $3, logo_url = $4, updated_at = NOW()
		WHERE id = $1
	`
	res, err := r.db.ExecContext(ctx, query, ws.ID, ws.Name, ws.Plan, ws.LogoURL)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrWorkspaceNotFound
	}
	return nil
}
