package user

import (
	"context"
	"strings"

	"backend/internal/domain/model"
	"backend/internal/infrastructure/database"
)

type Repository struct {
	db database.Queryer
}

func NewRepository(db database.Queryer) *Repository {
	return &Repository{db: db}
}

func (r *Repository) FindByEmail(ctx context.Context, email string) (model.AuthUser, error) {
	const query = `
		SELECT id, account_no, email, password_hash, array_to_string(roles, ','), created_at, updated_at
		FROM users
		WHERE email = $1
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
	)
	if roles != "" {
		user.Roles = strings.Split(roles, ",")
	}
	return user, err
}
