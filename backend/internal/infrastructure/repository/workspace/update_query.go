package workspace

import (
	"context"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) Update(ctx context.Context, ws model.Workspace, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockWorkspaceAdmin(ctx, tx, ws.ID, actorID, false); err != nil {
			return err
		}
		const query = `
		UPDATE workspaces
		SET name = $2, plan = $3, logo_url = $4, updated_at = NOW()
		WHERE id = $1
		`
		res, err := tx.ExecContext(ctx, query, ws.ID, ws.Name, ws.Plan, ws.LogoURL)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrWorkspaceNotFound
		}
		return nil
	})
}
