package document

import (
	"context"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) UpdateThumbnails(ctx context.Context, id uuid.UUID, thumb, thumbDark, thumbPreview, thumbPreviewDark string) error {
	const query = `
		UPDATE documents
		SET thumbnail = $2, thumbnail_dark = $3, thumbnail_preview = $4, thumbnail_preview_dark = $5, updated_at = NOW()
		WHERE id = $1 AND deleted_at IS NULL
	`
	res, err := r.db.ExecContext(ctx, query, id, thumb, thumbDark, thumbPreview, thumbPreviewDark)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return constant.ErrDocumentNotFound
	}
	return nil
}
