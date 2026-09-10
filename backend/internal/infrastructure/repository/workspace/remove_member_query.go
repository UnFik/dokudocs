package workspace

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) RemoveMember(ctx context.Context, workspaceID, userID uuid.UUID) error {
	const query = `
		DELETE FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
	`
	_, err := r.db.ExecContext(ctx, query, workspaceID, userID)
	return err
}
