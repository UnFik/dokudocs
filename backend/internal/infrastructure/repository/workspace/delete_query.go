package workspace

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) Delete(ctx context.Context, id, actorID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		rows, err := tx.QueryContext(ctx, `
			SELECT user_id, role::text FROM workspace_members
			WHERE workspace_id = $1
			ORDER BY user_id
			FOR UPDATE
		`, id)
		if err != nil {
			return err
		}
		actorRole := ""
		for rows.Next() {
			var userID uuid.UUID
			var role string
			if err := rows.Scan(&userID, &role); err != nil {
				rows.Close()
				return err
			}
			if userID == actorID {
				actorRole = role
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		if actorRole != "owner" {
			return constant.ErrForbidden
		}

		const query = `DELETE FROM workspaces WHERE id = $1`
		res, err := tx.ExecContext(ctx, query, id)
		if err != nil {
			return err
		}
		count, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if count == 0 {
			return constant.ErrWorkspaceNotFound
		}
		return nil
	})
}
