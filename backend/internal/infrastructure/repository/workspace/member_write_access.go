package workspace

import (
	"context"
	"database/sql"
	"errors"
	"sort"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func lockWorkspaceMembers(ctx context.Context, tx database.Queryer, workspaceID, actorID uuid.UUID, otherIDs ...uuid.UUID) (string, error) {
	ids := append(otherIDs, actorID)
	sort.Slice(ids, func(i, j int) bool { return ids[i].String() < ids[j].String() })
	actorRole := ""
	var previous uuid.UUID
	for i, userID := range ids {
		if i > 0 && userID == previous {
			continue
		}
		previous = userID
		var role string
		err := tx.QueryRowContext(ctx, `
			SELECT role::text FROM workspace_members
			WHERE workspace_id = $1 AND user_id = $2
			FOR UPDATE
		`, workspaceID, userID).Scan(&role)
		if errors.Is(err, sql.ErrNoRows) {
			if userID == actorID {
				return "", constant.ErrForbidden
			}
			continue
		}
		if err != nil {
			return "", err
		}
		if userID == actorID {
			actorRole = role
		}
	}
	return actorRole, nil
}

func lockWorkspaceAdmin(ctx context.Context, tx database.Queryer, workspaceID, actorID uuid.UUID, ownerOnly bool) error {
	var role string
	err := tx.QueryRowContext(ctx, `
		SELECT role::text FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
		FOR SHARE
	`, workspaceID, actorID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return constant.ErrForbidden
	}
	if err != nil {
		return err
	}
	if role != "owner" && (ownerOnly || role != "admin") {
		return constant.ErrForbidden
	}
	return nil
}
