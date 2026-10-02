package document

import (
	"context"
	"database/sql"
	"errors"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) ToggleStar(ctx context.Context, docID, workspaceID, userID uuid.UUID) (bool, error) {
	const check = `SELECT 1 FROM document_stars WHERE document_id = $1 AND user_id = $2`
	starred := false
	err := r.withReadableDocument(ctx, docID, workspaceID, userID, func(tx database.Queryer) error {
		var exists int
		err := tx.QueryRowContext(ctx, check, docID, userID).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			const insert = `INSERT INTO document_stars (document_id, user_id) VALUES ($1, $2)`
			if _, err := tx.ExecContext(ctx, insert, docID, userID); err != nil {
				return err
			}
			starred = true
			return nil
		}
		if err != nil {
			return err
		}
		const delete = `DELETE FROM document_stars WHERE document_id = $1 AND user_id = $2`
		_, err = tx.ExecContext(ctx, delete, docID, userID)
		return err
	})
	return starred, err
}
