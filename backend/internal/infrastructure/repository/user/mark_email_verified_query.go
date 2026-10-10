package user

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) MarkEmailVerified(ctx context.Context, id uuid.UUID) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now() WHERE id = $1`, id)
	return err
}
