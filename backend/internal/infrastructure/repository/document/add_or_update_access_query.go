package document

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) AddOrUpdateAccess(ctx context.Context, docID, userID uuid.UUID, level string) error {
	const query = `
		INSERT INTO document_accesses (document_id, user_id, access_level)
		VALUES ($1, $2, $3::document_access_level)
		ON CONFLICT (document_id, user_id) DO UPDATE SET
			access_level = EXCLUDED.access_level
	`
	_, err := r.db.ExecContext(ctx, query, docID, userID, level)
	return err
}
