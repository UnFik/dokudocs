package project

import (
	"context"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) Update(ctx context.Context, p model.Project, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockManagedProject(ctx, tx, p.ID, p.WorkspaceID, actorID); err != nil {
			return err
		}
		const query = `
		UPDATE projects
		SET name = $2, description = $3, logo_url = $4, color_badge = $5, visibility = $6::project_visibility, updated_at = NOW()
		WHERE id = $1 AND workspace_id = $7 AND deleted_at IS NULL
		`
		res, err := tx.ExecContext(ctx, query, p.ID, p.Name, p.Description, p.LogoURL, p.ColorBadge, p.Visibility, p.WorkspaceID)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrProjectNotFound
		}
		return nil
	})
}
