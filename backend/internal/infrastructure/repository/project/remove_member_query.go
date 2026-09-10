package project

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) RemoveMember(ctx context.Context, projectID, userID uuid.UUID) error {
	const query = `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`
	res, err := r.db.ExecContext(ctx, query, projectID, userID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrUserNotFound
	}
	return nil
}
