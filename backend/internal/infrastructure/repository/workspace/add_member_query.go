package workspace

import (
	"context"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) AddMember(ctx context.Context, workspaceID, actorID, userID uuid.UUID, role string) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		actorRole, err := lockWorkspaceMembers(ctx, tx, workspaceID, actorID, userID)
		if err != nil {
			return err
		}
		if actorRole != "owner" && actorRole != "admin" {
			return constant.ErrForbidden
		}
		const query = `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, $3::workspace_role)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET
			role = EXCLUDED.role
		`
		_, err = tx.ExecContext(ctx, query, workspaceID, userID, role)
		return err
	})
}
