package project

import (
	"context"
	"database/sql"
	"errors"
	"sort"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

func lockManagedProject(ctx context.Context, tx database.Queryer, projectID, workspaceID, actorID uuid.UUID, additionalMembers ...uuid.UUID) error {
	return lockProjectForRoles(ctx, tx, projectID, workspaceID, actorID, []string{"manager"}, additionalMembers...)
}

func lockEditableProject(ctx context.Context, tx database.Queryer, projectID, workspaceID, actorID uuid.UUID) error {
	return lockProjectForRoles(ctx, tx, projectID, workspaceID, actorID, []string{"manager", "editor"})
}

func lockReadableProject(ctx context.Context, tx database.Queryer, projectID, workspaceID, actorID uuid.UUID) error {
	var workspaceRole string
	err := tx.QueryRowContext(ctx, `
		SELECT role::text FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
		FOR SHARE
	`, workspaceID, actorID).Scan(&workspaceRole)
	if errors.Is(err, sql.ErrNoRows) {
		return constant.ErrForbidden
	}
	if err != nil {
		return err
	}

	var visibility string
	err = tx.QueryRowContext(ctx, `
		SELECT visibility::text FROM projects
		WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		FOR SHARE
	`, projectID, workspaceID).Scan(&visibility)
	if errors.Is(err, sql.ErrNoRows) {
		return constant.ErrProjectNotFound
	}
	if err != nil {
		return err
	}
	if workspaceRole == "owner" || workspaceRole == "admin" || visibility == "workspace" {
		return nil
	}

	var exists int
	err = tx.QueryRowContext(ctx, `
		SELECT 1 FROM project_members
		WHERE project_id = $1 AND user_id = $2
		FOR SHARE
	`, projectID, actorID).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return constant.ErrForbidden
	}
	return err
}

func lockProjectForRoles(ctx context.Context, tx database.Queryer, projectID, workspaceID, actorID uuid.UUID, allowedRoles []string, additionalMembers ...uuid.UUID) error {
	memberIDs := append(additionalMembers, actorID)
	sort.Slice(memberIDs, func(i, j int) bool { return memberIDs[i].String() < memberIDs[j].String() })
	workspaceRole := ""
	var previous uuid.UUID
	for i, userID := range memberIDs {
		if i > 0 && userID == previous {
			continue
		}
		previous = userID
		var role string
		err := tx.QueryRowContext(ctx, `
			SELECT role::text FROM workspace_members
			WHERE workspace_id = $1 AND user_id = $2
			FOR SHARE
		`, workspaceID, userID).Scan(&role)
		if errors.Is(err, sql.ErrNoRows) {
			return constant.ErrForbidden
		}
		if err != nil {
			return err
		}
		if userID == actorID {
			workspaceRole = role
		}
	}

	if err := lockProjectRow(ctx, tx, projectID, workspaceID); err != nil {
		return err
	}
	if workspaceRole == "owner" || workspaceRole == "admin" {
		return nil
	}

	var projectRole string
	err := tx.QueryRowContext(ctx, `
		SELECT role::text FROM project_members
		WHERE project_id = $1 AND user_id = $2
		FOR SHARE
	`, projectID, actorID).Scan(&projectRole)
	if errors.Is(err, sql.ErrNoRows) {
		return constant.ErrForbidden
	}
	if err != nil {
		return err
	}
	for _, role := range allowedRoles {
		if projectRole == role {
			return nil
		}
	}
	return constant.ErrForbidden
}

func lockWorkspaceProject(ctx context.Context, tx database.Queryer, projectID, workspaceID, actorID uuid.UUID) error {
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
	return lockProjectRow(ctx, tx, projectID, workspaceID)
}

func lockProjectRow(ctx context.Context, tx database.Queryer, projectID, workspaceID uuid.UUID) error {
	var lockedProjectID uuid.UUID
	err := tx.QueryRowContext(ctx, `
		SELECT id FROM projects
		WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, projectID, workspaceID).Scan(&lockedProjectID)
	if errors.Is(err, sql.ErrNoRows) {
		return constant.ErrProjectNotFound
	}
	return err
}
