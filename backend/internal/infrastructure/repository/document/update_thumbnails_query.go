package document

import (
	"context"
	"fmt"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) UpdateThumbnails(ctx context.Context, id, workspaceID, actorID uuid.UUID, thumb, thumbDark, thumbPreview, thumbPreviewDark string) error {
	if r.tx == nil {
		return fmt.Errorf("thumbnail update requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, id, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		res, err := tx.ExecContext(ctx, `
			UPDATE documents
			SET thumbnail = $3, thumbnail_dark = $4, thumbnail_preview = $5, thumbnail_preview_dark = $6, updated_at = NOW()
			WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		`, id, workspaceID, thumb, thumbDark, thumbPreview, thumbPreviewDark)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrDocumentNotFound
		}
		return nil
	})
}
