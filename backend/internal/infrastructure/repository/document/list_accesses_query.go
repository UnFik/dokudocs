package document

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) ListAccesses(ctx context.Context, docID uuid.UUID) ([]model.DocumentAccess, error) {
	const query = `
		SELECT da.document_id, da.user_id, da.access_level::text, da.created_at,
		       u.id, u.full_name, u.email, COALESCE(u.avatar_url, '')
		FROM document_accesses da
		JOIN users u ON u.id = da.user_id
		WHERE da.document_id = $1
		ORDER BY da.created_at ASC
	`
	rows, err := r.db.QueryContext(ctx, query, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accesses := make([]model.DocumentAccess, 0)
	for rows.Next() {
		var a model.DocumentAccess
		if err := rows.Scan(
			&a.DocumentID, &a.UserID, &a.AccessLevel, &a.CreatedAt,
			&a.User.ID, &a.User.Name, &a.User.Email, &a.User.Avatar,
		); err != nil {
			return nil, err
		}
		accesses = append(accesses, a)
	}
	return accesses, rows.Err()
}
