package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// IdentityRepository keeps the sign-in identities linked to Users.
type IdentityRepository interface {
	// FindUserID gives constant.ErrIdentityNotFound for an identity nobody linked.
	FindUserID(ctx context.Context, provider, subject string) (uuid.UUID, error)
	// Link ties an identity to a User; it gives constant.ErrIdentityInUse when
	// another User holds it and constant.ErrProviderAlreadyLinked when this User
	// already has an identity from the provider.
	Link(ctx context.Context, userID uuid.UUID, provider, subject, email, scope string) error
	// TakeOver drops the password of a User whose email was never verified and
	// marks the email verified.
	TakeOver(ctx context.Context, userID uuid.UUID) error
	// FillAvatar sets the avatar only when the User has none.
	FillAvatar(ctx context.Context, userID uuid.UUID, url string) error
	// LockUser serializes changes to a User's ways of signing in; call it first
	// in a transaction.
	LockUser(ctx context.Context, userID uuid.UUID) error
	ListByUser(ctx context.Context, userID uuid.UUID) ([]LinkedIdentity, error)
	HasPassword(ctx context.Context, userID uuid.UUID) (bool, error)
	// Unlink removes the User's identity from the provider.
	Unlink(ctx context.Context, userID uuid.UUID, provider string) error
	// SetPassword stores a hash only for a User who has none, otherwise it gives
	// constant.ErrPasswordAlreadySet.
	SetPassword(ctx context.Context, userID uuid.UUID, hash string) error
}

type LinkedIdentity struct {
	Provider string
	Email    string
	LinkedAt time.Time
}
