package document

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) RecordView(ctx context.Context, docID, userID uuid.UUID) error {
	const query = `
		INSERT INTO document_views (user_id, document_id, last_viewed_at, view_count)
		VALUES ($1, $2, NOW(), 1)
		ON CONFLICT (user_id, document_id) DO UPDATE SET
			last_viewed_at = NOW(),
			view_count = document_views.view_count + 1
	`
	_, err := r.db.ExecContext(ctx, query, userID, docID)
	return err
}
