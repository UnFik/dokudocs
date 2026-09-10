package project

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
)

func (r *Repository) ToggleStar(ctx context.Context, projectID, userID uuid.UUID) (bool, error) {
	const check = `SELECT 1 FROM project_stars WHERE project_id = $1 AND user_id = $2`
	var exists int
	err := r.db.QueryRowContext(ctx, check, projectID, userID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		const insert = `INSERT INTO project_stars (project_id, user_id) VALUES ($1, $2)`
		_, err := r.db.ExecContext(ctx, insert, projectID, userID)
		return true, err
	} else if err != nil {
		return false, err
	}

	const delete = `DELETE FROM project_stars WHERE project_id = $1 AND user_id = $2`
	_, err = r.db.ExecContext(ctx, delete, projectID, userID)
	return false, err
}
