package document

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) EmptyTrash(ctx context.Context, workspaceID, actorID uuid.UUID) error {
	if r.tx == nil {
		return fmt.Errorf("empty trash requires a transaction-capable database")
	}
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var role string
		err := tx.QueryRowContext(ctx, `
			SELECT role::text FROM workspace_members
			WHERE workspace_id = $1 AND user_id = $2
			FOR SHARE
		`, workspaceID, actorID).Scan(&role)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return constant.ErrForbidden
			}
			return err
		}
		if role != "owner" && role != "admin" {
			return constant.ErrForbidden
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM documents WHERE workspace_id = $1 AND deleted_at IS NOT NULL`, workspaceID)
		return err
	})
}
