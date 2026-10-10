package repository

import (
	"context"
	"time"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

// WorkspaceInviteRepository keeps pending invitations. Every method that takes
// an actor checks the actor's workspace role under a lock.
type WorkspaceInviteRepository interface {
	// Issue creates the pending invitation for the email or, when one exists,
	// replaces its link, role and expiry. ErrInviteTooSoon inside the cooldown.
	Issue(ctx context.Context, workspaceID, actorID uuid.UUID, email, role, tokenHash string, ttl, cooldown time.Duration) (model.WorkspaceInvite, error)
	Reissue(ctx context.Context, workspaceID, actorID, inviteID uuid.UUID, tokenHash string, ttl, cooldown time.Duration) (model.WorkspaceInvite, error)
	// Discard drops the invitation behind a link that could not be mailed.
	Discard(ctx context.Context, tokenHash string) error
	ListPending(ctx context.Context, workspaceID, actorID uuid.UUID) ([]model.WorkspaceInvite, error)
	Revoke(ctx context.Context, workspaceID, actorID, inviteID uuid.UUID) error
	// Preview and Accept return ErrInviteNotFound for a link that is unknown,
	// used, revoked or expired.
	Preview(ctx context.Context, tokenHash string) (model.InvitePreview, error)
	Accept(ctx context.Context, tokenHash string, userID uuid.UUID, userEmail string) (uuid.UUID, error)
}
