package user

import (
	"context"

	"backend/constant"
	"backend/internal/domain/model"
)

func (r *Repository) Create(ctx context.Context, user model.AuthUser, fullName string) error {
	var password any = user.PasswordHash
	if user.PasswordHash == "" {
		password = nil
	}
	const insertUser = `
		INSERT INTO users (id, account_no, email, password_hash, full_name, email_verified_at)
		VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::boolean THEN now() END)
	`
	if _, err := r.db.ExecContext(ctx, insertUser, user.ID, user.AccountNo, user.Email, password, fullName, user.EmailVerified); err != nil {
		return err
	}

	const insertSettings = `
		INSERT INTO user_settings (user_id)
		VALUES ($1)
		ON CONFLICT DO NOTHING
	`
	if _, err := r.db.ExecContext(ctx, insertSettings, user.ID); err != nil {
		return err
	}

	const assignRole = `
		INSERT INTO user_roles (user_id, role_id)
		SELECT $1::uuid, id FROM roles WHERE slug = 'member'
		ON CONFLICT DO NOTHING
	`
	result, err := r.db.ExecContext(ctx, assignRole, user.ID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return constant.ErrMemberRoleNotFound
	}
	return nil
}
