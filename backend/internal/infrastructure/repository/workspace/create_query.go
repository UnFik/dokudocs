package workspace

import (
	"context"
	"fmt"

	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) Create(ctx context.Context, ws model.Workspace) (model.Workspace, error) {
	if ws.ID == uuid.Nil {
		ws.ID = uuid.New()
	}
	const insertWS = `
		INSERT INTO workspaces (id, name, slug, plan, logo_url, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING created_at, updated_at
	`
	if r.tx == nil {
		return ws, fmt.Errorf("workspace create requires a transaction-capable database")
	}
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := tx.QueryRowContext(ctx, insertWS, ws.ID, ws.Name, ws.Slug, ws.Plan, ws.LogoURL, ws.CreatedBy).Scan(
			&ws.CreatedAt, &ws.UpdatedAt,
		); err != nil {
			return err
		}

		const insertMember = `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
		ON CONFLICT DO NOTHING
		`
		if _, err := tx.ExecContext(ctx, insertMember, ws.ID, ws.CreatedBy); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return ws, err
	}
	ws.Role = "owner"
	return ws, nil
}
