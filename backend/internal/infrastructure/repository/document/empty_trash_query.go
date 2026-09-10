package document

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) EmptyTrash(ctx context.Context, workspaceID uuid.UUID) error {
	const query = `DELETE FROM documents WHERE workspace_id = $1 AND deleted_at IS NOT NULL`
	_, err := r.db.ExecContext(ctx, query, workspaceID)
	return err
}
