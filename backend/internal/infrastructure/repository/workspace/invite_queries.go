package workspace

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"backend/constant"
	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

// maxPendingInvites caps what one workspace can have outstanding, so a stolen
// admin session cannot be used to mail a long list.
const maxPendingInvites = 50

const pendingInvite = `accepted_at IS NULL AND revoked_at IS NULL`

const inviteColumns = `id, workspace_id, email, role::text, invited_by, expires_at, created_at, last_sent_at`

func scanInvite(row interface{ Scan(...any) error }) (model.WorkspaceInvite, error) {
	var invite model.WorkspaceInvite
	err := row.Scan(&invite.ID, &invite.WorkspaceID, &invite.Email, &invite.Role,
		&invite.InvitedBy, &invite.ExpiresAt, &invite.CreatedAt, &invite.LastSentAt)
	return invite, err
}

// lockInviteAdmin returns the actor's role once it is known to be owner or
// admin, holding the member row so a demotion cannot slip in underneath.
func lockInviteAdmin(ctx context.Context, tx database.Queryer, workspaceID, actorID uuid.UUID) (string, error) {
	var role string
	err := tx.QueryRowContext(ctx, `
		SELECT role::text FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
		FOR SHARE
	`, workspaceID, actorID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", constant.ErrForbidden
	}
	if err != nil {
		return "", err
	}
	if role != "owner" && role != "admin" {
		return "", constant.ErrForbidden
	}
	return role, nil
}

// canManage is whether an actor of actorRole may handle an invitation to role:
// only an owner deals with admin invitations.
func canManage(actorRole, role string) bool {
	return role != "admin" || actorRole == "owner"
}

func (r *Repository) Issue(ctx context.Context, workspaceID, actorID uuid.UUID, email, role, tokenHash string, ttl, cooldown time.Duration) (model.WorkspaceInvite, error) {
	var invite model.WorkspaceInvite
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		actorRole, err := lockInviteAdmin(ctx, tx, workspaceID, actorID)
		if err != nil {
			return err
		}
		if !canManage(actorRole, role) {
			return constant.ErrForbidden
		}
		// One invitation writer per workspace: the cap and the per-email
		// uniqueness below hold without retrying on a unique violation.
		if _, err := tx.ExecContext(ctx, `SELECT 1 FROM workspaces WHERE id = $1 FOR UPDATE`, workspaceID); err != nil {
			return err
		}
		var member bool
		if err := tx.QueryRowContext(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id
				WHERE wm.workspace_id = $1 AND lower(u.email) = $2
			)`, workspaceID, email).Scan(&member); err != nil {
			return err
		}
		if member {
			return constant.ErrAlreadyMember
		}
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM workspace_invites
			WHERE workspace_id = $1 AND `+pendingInvite+` AND expires_at <= now()`, workspaceID); err != nil {
			return err
		}
		var existing uuid.UUID
		err = tx.QueryRowContext(ctx, `
			SELECT id FROM workspace_invites
			WHERE workspace_id = $1 AND email = $2 AND `+pendingInvite+`
			FOR UPDATE`, workspaceID, email).Scan(&existing)
		switch {
		case err == nil:
			invite, err = refreshInvite(ctx, tx, existing, role, actorID, tokenHash, ttl, cooldown)
			return err
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
		var pending int
		if err := tx.QueryRowContext(ctx, `
			SELECT count(*) FROM workspace_invites WHERE workspace_id = $1 AND `+pendingInvite, workspaceID).Scan(&pending); err != nil {
			return err
		}
		if pending >= maxPendingInvites {
			return constant.ErrInviteLimit
		}
		invite, err = scanInvite(tx.QueryRowContext(ctx, `
			INSERT INTO workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
			VALUES ($1, $2, $3::workspace_role, $4, $5, now() + make_interval(secs => $6))
			RETURNING `+inviteColumns, workspaceID, email, role, tokenHash, actorID, ttl.Seconds()))
		return err
	})
	return invite, err
}

// refreshInvite swaps the link of a pending invitation unless one went out
// within the cooldown. The caller holds the row.
func refreshInvite(ctx context.Context, tx database.Queryer, id uuid.UUID, role string, actorID uuid.UUID, tokenHash string, ttl, cooldown time.Duration) (model.WorkspaceInvite, error) {
	var recent bool
	if err := tx.QueryRowContext(ctx, `
		SELECT last_sent_at > now() - make_interval(secs => $2) FROM workspace_invites WHERE id = $1`,
		id, cooldown.Seconds()).Scan(&recent); err != nil {
		return model.WorkspaceInvite{}, err
	}
	if recent {
		return model.WorkspaceInvite{}, constant.ErrInviteTooSoon
	}
	return scanInvite(tx.QueryRowContext(ctx, `
		UPDATE workspace_invites
		SET token_hash = $2, role = $3::workspace_role, invited_by = $4,
		    expires_at = now() + make_interval(secs => $5), last_sent_at = now()
		WHERE id = $1
		RETURNING `+inviteColumns, id, tokenHash, role, actorID, ttl.Seconds()))
}

func (r *Repository) Reissue(ctx context.Context, workspaceID, actorID, inviteID uuid.UUID, tokenHash string, ttl, cooldown time.Duration) (model.WorkspaceInvite, error) {
	var invite model.WorkspaceInvite
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		actorRole, err := lockInviteAdmin(ctx, tx, workspaceID, actorID)
		if err != nil {
			return err
		}
		var role string
		err = tx.QueryRowContext(ctx, `
			SELECT role::text FROM workspace_invites
			WHERE id = $1 AND workspace_id = $2 AND `+pendingInvite+` AND expires_at > now()
			FOR UPDATE`, inviteID, workspaceID).Scan(&role)
		if errors.Is(err, sql.ErrNoRows) {
			return constant.ErrInviteNotFound
		}
		if err != nil {
			return err
		}
		if !canManage(actorRole, role) {
			return constant.ErrForbidden
		}
		invite, err = refreshInvite(ctx, tx, inviteID, role, actorID, tokenHash, ttl, cooldown)
		return err
	})
	return invite, err
}

func (r *Repository) Discard(ctx context.Context, tokenHash string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM workspace_invites WHERE token_hash = $1 AND `+pendingInvite, tokenHash)
	return err
}

func (r *Repository) ListPending(ctx context.Context, workspaceID, actorID uuid.UUID) ([]model.WorkspaceInvite, error) {
	var invites []model.WorkspaceInvite
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		if _, err := lockInviteAdmin(ctx, tx, workspaceID, actorID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, `
			SELECT `+inviteColumns+` FROM workspace_invites
			WHERE workspace_id = $1 AND `+pendingInvite+` AND expires_at > now()
			ORDER BY created_at DESC`, workspaceID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			invite, err := scanInvite(rows)
			if err != nil {
				return err
			}
			invites = append(invites, invite)
		}
		return rows.Err()
	})
	return invites, err
}

func (r *Repository) Revoke(ctx context.Context, workspaceID, actorID, inviteID uuid.UUID) error {
	return r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		actorRole, err := lockInviteAdmin(ctx, tx, workspaceID, actorID)
		if err != nil {
			return err
		}
		var role string
		err = tx.QueryRowContext(ctx, `
			SELECT role::text FROM workspace_invites
			WHERE id = $1 AND workspace_id = $2 AND `+pendingInvite+`
			FOR UPDATE`, inviteID, workspaceID).Scan(&role)
		if errors.Is(err, sql.ErrNoRows) {
			return constant.ErrInviteNotFound
		}
		if err != nil {
			return err
		}
		if !canManage(actorRole, role) {
			return constant.ErrForbidden
		}
		_, err = tx.ExecContext(ctx, `UPDATE workspace_invites SET revoked_at = now() WHERE id = $1`, inviteID)
		return err
	})
}

func (r *Repository) Preview(ctx context.Context, tokenHash string) (model.InvitePreview, error) {
	var preview model.InvitePreview
	err := r.db.QueryRowContext(ctx, `
		SELECT w.name, COALESCE(NULLIF(u.full_name, ''), u.email), i.role::text, i.email
		FROM workspace_invites i
		JOIN workspaces w ON w.id = i.workspace_id
		JOIN users u ON u.id = i.invited_by
		WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()`,
		tokenHash).Scan(&preview.WorkspaceName, &preview.InviterName, &preview.Role, &preview.Email)
	if errors.Is(err, sql.ErrNoRows) {
		return preview, constant.ErrInviteNotFound
	}
	return preview, err
}

func (r *Repository) Accept(ctx context.Context, tokenHash string, userID uuid.UUID, userEmail string) (uuid.UUID, error) {
	var workspaceID uuid.UUID
	err := r.tx.WithTransaction(ctx, func(tx database.Queryer) error {
		var inviteID uuid.UUID
		var email, role string
		err := tx.QueryRowContext(ctx, `
			SELECT id, workspace_id, email, role::text FROM workspace_invites
			WHERE token_hash = $1 AND `+pendingInvite+` AND expires_at > now()
			FOR UPDATE`, tokenHash).Scan(&inviteID, &workspaceID, &email, &role)
		if errors.Is(err, sql.ErrNoRows) {
			return constant.ErrInviteNotFound
		}
		if err != nil {
			return err
		}
		if !strings.EqualFold(email, userEmail) {
			return constant.ErrInviteEmailMismatch
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE workspace_invites SET accepted_at = now(), accepted_by = $2 WHERE id = $1`, inviteID, userID); err != nil {
			return err
		}
		// Already a member (say, through a second invitation): keep the role they have.
		_, err = tx.ExecContext(ctx, `
			INSERT INTO workspace_members (workspace_id, user_id, role)
			VALUES ($1, $2, $3::workspace_role)
			ON CONFLICT (workspace_id, user_id) DO NOTHING`, workspaceID, userID, role)
		return err
	})
	return workspaceID, err
}
