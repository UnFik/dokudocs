package document

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) Move(ctx context.Context, id uuid.UUID, targetProjectID *uuid.UUID) error {
	const query = `
		UPDATE documents
		SET project_id = $2, updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`
	res, err := r.db.ExecContext(ctx, query, id, targetProjectID)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrDocumentNotFound
	}
	// Clear old project categories
	_, _ = r.db.ExecContext(ctx, `DELETE FROM document_category_mappings WHERE document_id = $1`, id)
	return nil
}
