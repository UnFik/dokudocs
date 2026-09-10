package project

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) AddOrUpdateMember(ctx context.Context, projectID, userID uuid.UUID, role string) error {
	const query = `
		INSERT INTO project_members (project_id, user_id, role)
		VALUES ($1, $2, $3::project_member_role)
		ON CONFLICT (project_id, user_id) DO UPDATE SET
			role = EXCLUDED.role
	`
	_, err := r.db.ExecContext(ctx, query, projectID, userID, role)
	return err
}
