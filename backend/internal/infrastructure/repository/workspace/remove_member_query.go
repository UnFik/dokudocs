package workspace

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) RemoveMember(ctx context.Context, workspaceID, actorID, userID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		actorRole, err := lockWorkspaceMembers(ctx, tx, workspaceID, actorID, userID)
		if err != nil {
			return err
		}
		if actorID != userID && actorRole != "owner" && actorRole != "admin" {
			return constant.ErrForbidden
		}
		const query = `
		DELETE FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
		`
		res, err := tx.ExecContext(ctx, query, workspaceID, userID)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrUserNotFound
		}
		return nil
	})
}
