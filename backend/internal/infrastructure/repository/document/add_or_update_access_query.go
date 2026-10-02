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

func (r *Repository) AddOrUpdateAccess(ctx context.Context, docID, workspaceID, actorID, userID uuid.UUID, level string) error {
	if r.tx == nil {
		return fmt.Errorf("document access update requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		doc, access, err := lockDocumentAccess(ctx, tx, docID, workspaceID, actorID, false, nil, userID)
		if err != nil {
			return err
		}
		if !policy.CanEditDocument(doc, access) {
			return constant.ErrForbidden
		}
		if level == "owner" && !policy.CanManageDocumentOwnership(access) {
			return constant.ErrForbidden
		}
		var targetLevel string
		targetErr := tx.QueryRowContext(ctx, `
			SELECT access_level::text FROM document_accesses
			WHERE document_id = $1 AND user_id = $2
			FOR UPDATE
		`, docID, userID).Scan(&targetLevel)
		if targetErr != nil && !errors.Is(targetErr, sql.ErrNoRows) {
			return targetErr
		}
		if targetErr == nil && targetLevel == "owner" && level != "owner" {
			if !policy.CanManageDocumentOwnership(access) {
				return constant.ErrForbidden
			}
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
		const query = `
			INSERT INTO document_accesses (document_id, user_id, access_level)
			VALUES ($1, $2, $3::document_access_level)
			ON CONFLICT (document_id, user_id) DO UPDATE SET access_level = EXCLUDED.access_level
		`
		_, err = tx.ExecContext(ctx, query, docID, userID, level)
		return err
	})
}
