package document

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) SoftDelete(ctx context.Context, id, userID uuid.UUID) error {
	const query = `
		UPDATE documents
		SET deleted_at = NOW(), deleted_by = $2
		WHERE id = $1 AND deleted_at IS NULL
	`
	res, err := r.db.ExecContext(ctx, query, id, userID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrDocumentNotFound
	}
	return nil
}
