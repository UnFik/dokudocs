package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"backend/constant"
	"backend/internal/domain/policy"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) RemoveAccess(ctx context.Context, docID, workspaceID, actorID, userID uuid.UUID) error {
	if r.tx == nil {
		return fmt.Errorf("document access removal requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, docID, workspaceID, actorID, false, nil)
		if err != nil {
			return err
		}
		if actorID == userID {
			if !policy.CanReadDocument(doc, access) {
				return constant.ErrForbidden
			}
		} else if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		var targetLevel string
		err = tx.QueryRowContext(ctx, `
			SELECT access_level::text FROM document_accesses
			WHERE document_id = $1 AND user_id = $2
		`, docID, userID).Scan(&targetLevel)
		if errors.Is(err, sql.ErrNoRows) {
			return constant.ErrAccessNotFound
		}
		if err != nil {
			return err
		}
		if targetLevel == "owner" && !policy.CanManageDocumentOwnership(access) {
			return constant.ErrForbidden
		}
		if targetLevel == "owner" {
			var hasOtherOwner bool
			if err := tx.QueryRowContext(ctx, `
				SELECT EXISTS (
					SELECT 1 FROM document_accesses
					WHERE document_id = $1 AND user_id <> $2 AND access_level = 'owner'
				)
			`, docID, userID).Scan(&hasOtherOwner); err != nil {
				return err
			}
			if !hasOtherOwner {
				return constant.ErrForbidden
			}
		}
		res, err := tx.ExecContext(ctx, `DELETE FROM document_accesses WHERE document_id = $1 AND user_id = $2`, docID, userID)
		if err != nil {
			return err
		}
		rows, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if rows == 0 {
			return constant.ErrAccessNotFound
		}
		return nil
	})
}
