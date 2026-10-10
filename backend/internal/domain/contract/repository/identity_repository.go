package repository

import (
	"context"

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
}
