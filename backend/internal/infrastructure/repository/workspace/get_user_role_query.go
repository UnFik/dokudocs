package workspace

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"

	"github.com/google/uuid"
)

func (r *Repository) GetUserRole(ctx context.Context, workspaceID, userID uuid.UUID) (string, error) {
	const query = `
		SELECT role::text
		FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
	`
	var role string
	err := r.db.QueryRowContext(ctx, query, workspaceID, userID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", constant.ErrForbidden
	}
	return role, err
}
