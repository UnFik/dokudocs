package project

import (
	"context"

	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func (r *Repository) AddOrUpdateMember(ctx context.Context, projectID, workspaceID, actorID, userID uuid.UUID, role string) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if err := lockManagedProject(ctx, tx, projectID, workspaceID, actorID, userID); err != nil {
			return err
		}
		const query = `
		INSERT INTO project_members (project_id, user_id, role)
		VALUES ($1, $2, $3::project_member_role)
		ON CONFLICT (project_id, user_id) DO UPDATE SET
			role = EXCLUDED.role
		`
		_, err := tx.ExecContext(ctx, query, projectID, userID, role)
		return err
	})
}
