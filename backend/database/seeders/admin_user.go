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
	FullName     string
	Roles        []string
}

var AdminUser = User{
	ID:           "00000000-0000-0000-0000-000000000001",
	AccountNo:    "ACC001",
	Email:        "admin@example.com",
	PasswordHash: "$2b$10$spIx2n0YXUjQqPHKX5SVJ.A9F8Zhg6ENvnAOFXEDbwId2rz.86Eyq",
	FullName:     "System Administrator",
	Roles:        []string{"superadmin", "admin"},
}

func init() {
	Register(func(ctx context.Context, db *sql.DB) error {
		return SeedAdminUser(ctx, db, AdminUser)
	})
}

func SeedAdminUser(ctx context.Context, db *sql.DB, user User) error {
	// 1. Seed Roles
	const seedRolesQuery = `
		INSERT INTO roles (name, slug, description, is_system)
		VALUES 
			('Super Administrator', 'superadmin', 'System super administrator with full privileges', true),
			('Administrator', 'admin', 'Workspace and system administrator', true),
			('Member', 'member', 'Standard platform member', true),
			('Support', 'support', 'Platform customer support', true)
		ON CONFLICT (slug) DO NOTHING;
	`
	if _, err := db.ExecContext(ctx, seedRolesQuery); err != nil {
		return err
	}

	// 2. Seed User
	const seedUserQuery = `
		INSERT INTO users (id, account_no, email, password_hash, full_name)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (email) DO UPDATE SET
			account_no = EXCLUDED.account_no,
			password_hash = EXCLUDED.password_hash,
			full_name = EXCLUDED.full_name,
			updated_at = NOW();
	`
	if _, err := db.ExecContext(ctx, seedUserQuery, user.ID, user.AccountNo, user.Email, user.PasswordHash, user.FullName); err != nil {
		return err
	}

	// 3. Seed Default User Settings
	const seedSettingsQuery = `
		INSERT INTO user_settings (user_id)
		VALUES ($1)
		ON CONFLICT (user_id) DO NOTHING;
	`
	if _, err := db.ExecContext(ctx, seedSettingsQuery, user.ID); err != nil {
		return err
	}

	// 4. Assign Roles to User
	const assignRolesQuery = `
		INSERT INTO user_roles (user_id, role_id, assigned_at)
		SELECT $1::uuid, id, NOW()
		FROM roles
		WHERE slug = ANY($2)
		ON CONFLICT (user_id, role_id) DO NOTHING;
	`
	var rolesParam []string = user.Roles
	if _, err := db.ExecContext(ctx, assignRolesQuery, user.ID, rolesParam); err != nil {
		return err
	}

	return nil
}
