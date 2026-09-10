package document

import (
	"context"
	"database/sql"
	"errors"

	"github.com/google/uuid"
)

func (r *Repository) ToggleStar(ctx context.Context, docID, userID uuid.UUID) (bool, error) {
	const check = `SELECT 1 FROM document_stars WHERE document_id = $1 AND user_id = $2`
	var exists int
	err := r.db.QueryRowContext(ctx, check, docID, userID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		const insert = `INSERT INTO document_stars (document_id, user_id) VALUES ($1, $2)`
		_, err := r.db.ExecContext(ctx, insert, docID, userID)
		return true, err
	} else if err != nil {
		return false, err
	}

	const delete = `DELETE FROM document_stars WHERE document_id = $1 AND user_id = $2`
	_, err = r.db.ExecContext(ctx, delete, docID, userID)
	return false, err
}
