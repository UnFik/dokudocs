package seeders

import (
	"context"
	"database/sql"
)

type User struct {
	ID           string
	AccountNo    string
	Email        string
	PasswordHash string
	Roles        []string
}

var AdminUser = User{
	ID:           "00000000-0000-0000-0000-000000000001",
	AccountNo:    "ACC001",
	Email:        "admin@example.com",
	PasswordHash: "$2b$10$spIx2n0YXUjQqPHKX5SVJ.A9F8Zhg6ENvnAOFXEDbwId2rz.86Eyq",
	Roles:        []string{"admin"},
}

func init() {
	Register(func(ctx context.Context, db *sql.DB) error {
		return SeedAdminUser(ctx, db, AdminUser)
	})
}

func SeedAdminUser(ctx context.Context, db *sql.DB, user User) error {
	const query = `
		INSERT INTO users (id, account_no, email, password_hash, roles)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (email) DO UPDATE SET
			account_no = EXCLUDED.account_no,
			password_hash = EXCLUDED.password_hash,
			roles = EXCLUDED.roles,
			updated_at = NOW()
	`
	_, err := db.ExecContext(ctx, query, user.ID, user.AccountNo, user.Email, user.PasswordHash, user.Roles)
	return err
}
