package workspace

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) GetMemberProfile(ctx context.Context, workspaceID, userID uuid.UUID) (model.MemberProfile, error) {
	const query = `
		SELECT u.id, u.email, u.full_name, COALESCE(u.avatar_url, ''), COALESCE(u.bio, ''),
		       wm.role::text, wm.joined_at
		FROM workspace_members wm
		JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1 AND wm.user_id = $2
	`
	var p model.MemberProfile
	err := r.db.QueryRowContext(ctx, query, workspaceID, userID).Scan(
		&p.UserID, &p.Email, &p.FullName, &p.AvatarURL, &p.Bio, &p.Role, &p.JoinedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return p, constant.ErrUserNotFound
	}
	return p, err
}
