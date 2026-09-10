package document

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) GetUserAccessLevel(ctx context.Context, docID, userID uuid.UUID) (string, error) {
	const query = `SELECT access_level::text FROM document_accesses WHERE document_id = $1 AND user_id = $2`
	var level string
	err := r.db.QueryRowContext(ctx, query, docID, userID).Scan(&level)
	if errors.Is(err, sql.ErrNoRows) {
		return "", constant.ErrForbidden
	}
	return level, err
}
