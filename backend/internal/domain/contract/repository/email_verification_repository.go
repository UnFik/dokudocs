package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// EmailVerificationRepository keeps the one-time links sent to prove an address.
// Only hashes of the links are stored, and every time comparison uses the
// database clock.
type EmailVerificationRepository interface {
	// Issue replaces the User's pending links with one that lasts ttl. It returns
	// constant.ErrVerificationTooSoon while a link made within cooldown exists.
	Issue(ctx context.Context, userID uuid.UUID, tokenHash string, ttl, cooldown time.Duration) error
	// Discard removes a link that could not be sent.
	Discard(ctx context.Context, tokenHash string) error
	// Consume uses a link up and returns its User; a link that is unknown, used
	// or expired gives constant.ErrInvalidVerificationToken.
	Consume(ctx context.Context, tokenHash string) (uuid.UUID, error)
}
