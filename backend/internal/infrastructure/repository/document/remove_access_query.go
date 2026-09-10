package document

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) RemoveAccess(ctx context.Context, docID, userID uuid.UUID) error {
	const query = `DELETE FROM document_accesses WHERE document_id = $1 AND user_id = $2`
	res, err := r.db.ExecContext(ctx, query, docID, userID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrAccessNotFound
	}
	return nil
}
