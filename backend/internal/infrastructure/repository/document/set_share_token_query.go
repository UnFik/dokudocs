package document

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) SetShareToken(ctx context.Context, docID uuid.UUID, token, visibility string) error {
	const query = `
		UPDATE documents
		SET share_token = $2, visibility = $3::document_visibility, updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`
	res, err := r.db.ExecContext(ctx, query, docID, token, visibility)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrDocumentNotFound
	}
	return nil
}
