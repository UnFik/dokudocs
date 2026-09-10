package user

import (
	"context"

	"backend/internal/domain/model"
)

func (r *Repository) Create(ctx context.Context, user model.AuthUser, fullName string) error {
	const insertUser = `
		INSERT INTO users (id, account_no, email, password_hash, full_name)
		VALUES ($1, $2, $3, $4, $5)
	`
	if _, err := r.db.ExecContext(ctx, insertUser, user.ID, user.AccountNo, user.Email, user.PasswordHash, fullName); err != nil {
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
	_, err := r.db.ExecContext(ctx, assignRole, user.ID)
	return err
}
