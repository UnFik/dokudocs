package user

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) UpdateProfile(ctx context.Context, id uuid.UUID, fullName, phone, bio string) error {
	const query = `
		UPDATE users
		SET full_name = $2, phone_number = $3, bio = $4, updated_at = NOW()
		WHERE id = $1
	`
	_, err := r.db.ExecContext(ctx, query, id, fullName, phone, bio)
	return err
}
