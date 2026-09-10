package project

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) SoftDelete(ctx context.Context, id uuid.UUID) error {
	const query = `UPDATE projects SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`
	res, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrProjectNotFound
	}
	return nil
}
