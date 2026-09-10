package document

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) Restore(ctx context.Context, id uuid.UUID) error {
	const query = `
		UPDATE documents
		SET deleted_at = NULL, deleted_by = NULL
		WHERE id = $1 AND deleted_at IS NOT NULL
	`
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
