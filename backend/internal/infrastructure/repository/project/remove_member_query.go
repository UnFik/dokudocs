package project

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) RemoveMember(ctx context.Context, projectID, workspaceID, actorID, userID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if actorID == userID {
			if err := lockWorkspaceProject(ctx, tx, projectID, workspaceID, actorID); err != nil {
				return err
			}
		} else if err := lockManagedProject(ctx, tx, projectID, workspaceID, actorID); err != nil {
			return err
		}
		const query = `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`
		res, err := tx.ExecContext(ctx, query, projectID, userID)
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
