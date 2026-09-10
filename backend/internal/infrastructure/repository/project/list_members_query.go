package project

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) ListMembers(ctx context.Context, projectID uuid.UUID) ([]model.ProjectMember, error) {
	const query = `
		SELECT pm.project_id, pm.user_id, pm.role::text, pm.created_at,
		       u.id, u.email, u.full_name, COALESCE(u.avatar_url, '')
		FROM project_members pm
		JOIN users u ON u.id = pm.user_id
		WHERE pm.project_id = $1
		ORDER BY pm.created_at ASC
	`
	rows, err := r.db.QueryContext(ctx, query, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]model.ProjectMember, 0)
	for rows.Next() {
		var m model.ProjectMember
		if err := rows.Scan(
			&m.ProjectID, &m.UserID, &m.Role, &m.CreatedAt,
			&m.User.ID, &m.User.Email, &m.User.FullName, &m.User.AvatarURL,
		); err != nil {
			return nil, err
		}
		m.ID = m.ProjectID.String() + ":" + m.UserID.String()
		members = append(members, m)
	}
	return members, rows.Err()
}
