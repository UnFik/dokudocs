package user

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) FindByID(ctx context.Context, id uuid.UUID) (model.UserProfile, error) {
	const query = `
		SELECT id, account_no, email, full_name, COALESCE(phone_number, ''),
		       COALESCE(bio, ''), COALESCE(avatar_url, ''), created_at, updated_at,
		       email_verified_at IS NOT NULL
		FROM users
		WHERE id = $1
	`
	var u model.UserProfile
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&u.ID, &u.AccountNo, &u.Email, &u.FullName, &u.PhoneNumber,
		&u.Bio, &u.AvatarURL, &u.CreatedAt, &u.UpdatedAt, &u.EmailVerified,
	)
	return u, err
}
