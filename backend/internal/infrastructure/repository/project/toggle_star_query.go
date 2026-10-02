package project

import (
	"context"
	"database/sql"
	"errors"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) ToggleStar(ctx context.Context, projectID, workspaceID, userID uuid.UUID) (starred bool, err error) {
	err = r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockReadableProject(ctx, tx, projectID, workspaceID, userID); err != nil {
			return err
		}
		const check = `SELECT 1 FROM project_stars WHERE project_id = $1 AND user_id = $2`
		var exists int
		err := tx.QueryRowContext(ctx, check, projectID, userID).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			const insert = `INSERT INTO project_stars (project_id, user_id) VALUES ($1, $2)`
			_, err := tx.ExecContext(ctx, insert, projectID, userID)
			starred = true
			return err
		} else if err != nil {
			return err
		}

		const delete = `DELETE FROM project_stars WHERE project_id = $1 AND user_id = $2`
		_, err = tx.ExecContext(ctx, delete, projectID, userID)
		starred = false
		return err
	})
	return starred, err
}
