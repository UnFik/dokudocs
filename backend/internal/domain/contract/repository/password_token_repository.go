package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// PasswordTokenRepository keeps the one-time links mailed so a User can set or
// change a password. Only hashes are stored, every comparison uses the database
// clock, and a link only ever works for the User it was made for.
type PasswordTokenRepository interface {
	// Issue replaces the User's pending links with one that lasts ttl. It returns
	// constant.ErrPasswordLinkTooSoon while a link made within cooldown exists.
	Issue(ctx context.Context, userID uuid.UUID, tokenHash string, ttl, cooldown time.Duration) error
	// Discard removes a link that could not be sent.
	Discard(ctx context.Context, tokenHash string) error
	// Check reports whether the link is usable by the User, without using it up.
	// A link that is unknown, used, expired or someone else's gives
	// constant.ErrInvalidPasswordLink.
	Check(ctx context.Context, userID uuid.UUID, tokenHash string) error
	// Consume uses the link up, with the same errors as Check.
	Consume(ctx context.Context, userID uuid.UUID, tokenHash string) error
}
