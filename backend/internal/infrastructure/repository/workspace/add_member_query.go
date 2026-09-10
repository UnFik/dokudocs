package workspace

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) AddMember(ctx context.Context, workspaceID, userID uuid.UUID, role string) error {
	const query = `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, $3::workspace_role)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET
			role = EXCLUDED.role
	`
	_, err := r.db.ExecContext(ctx, query, workspaceID, userID, role)
	return err
}
