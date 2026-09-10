package document

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) PermanentDelete(ctx context.Context, id uuid.UUID) error {
	const query = `DELETE FROM documents WHERE id = $1 AND deleted_at IS NOT NULL`
	res, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrDocumentNotFound
	}
	return nil
}
