package user

import (
	"context"
	"strings"

	"backend/internal/domain/model"
)

func (r *Repository) FindByEmail(ctx context.Context, email string) (model.AuthUser, error) {
	const query = `
		SELECT u.id, u.account_no, u.email, COALESCE(u.password_hash, ''),
		       COALESCE(string_agg(r.slug, ','), ''), u.created_at, u.updated_at,
		       u.email_verified_at IS NOT NULL
		FROM users u
		LEFT JOIN user_roles ur ON ur.user_id = u.id
		LEFT JOIN roles r ON r.id = ur.role_id
		WHERE u.email = $1
		GROUP BY u.id, u.account_no, u.email, u.password_hash, u.created_at, u.updated_at, u.email_verified_at
	`
	var user model.AuthUser
	var roles string
	err := r.db.QueryRowContext(ctx, query, email).Scan(
		&user.ID,
		&user.AccountNo,
		&user.Email,
		&user.PasswordHash,
		&roles,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.EmailVerified,
	)
	if err != nil {
		return user, err
	}
	if roles != "" {
		user.Roles = strings.Split(roles, ",")
	}
	return user, nil
}
