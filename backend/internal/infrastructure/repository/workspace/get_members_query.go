package workspace

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) GetMembers(ctx context.Context, workspaceID uuid.UUID) ([]model.WorkspaceMember, error) {
	const query = `
		SELECT wm.workspace_id, wm.user_id, u.email, u.full_name, COALESCE(u.avatar_url, ''),
		       wm.role::text, wm.joined_at
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1
		ORDER BY wm.joined_at ASC
	`
	rows, err := r.db.QueryContext(ctx, query, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []model.WorkspaceMember
	for rows.Next() {
		var m model.WorkspaceMember
		if err := rows.Scan(
			&m.WorkspaceID, &m.UserID, &m.Email, &m.FullName,
			&m.AvatarURL, &m.Role, &m.JoinedAt,
		); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}
