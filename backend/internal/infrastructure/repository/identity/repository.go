package identity

import (
	"context"
	"database/sql"
	"errors"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

type Repository struct {
	db database.Queryer
}

func NewRepository(db database.Queryer) *Repository { return &Repository{db: db} }

func (r *Repository) FindUserID(ctx context.Context, provider, subject string) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.db.QueryRowContext(ctx, `SELECT user_id FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2`, provider, subject).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, constant.ErrIdentityNotFound
	}
	return id, err
}

func (r *Repository) Link(ctx context.Context, userID uuid.UUID, provider, subject, email, scope string) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO oauth_accounts (user_id, provider, provider_user_id, provider_email, scope)
		VALUES ($1, $2, $3, $4, $5)`, userID, provider, subject, email, scope)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		switch pgErr.ConstraintName {
		case "idx_oauth_provider_user":
			return constant.ErrIdentityInUse
		case "idx_oauth_user_provider":
			return constant.ErrProviderAlreadyLinked
		}
	}
	return err
}

func (r *Repository) TakeOver(ctx context.Context, userID uuid.UUID) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE users SET password_hash = NULL, email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
		WHERE id = $1`, userID)
	return err
}

func (r *Repository) FillAvatar(ctx context.Context, userID uuid.UUID, url string) error {
	if url == "" {
		return nil
	}
	_, err := r.db.ExecContext(ctx, `
		UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1 AND (avatar_url IS NULL OR avatar_url = '')`, userID, url)
	return err
}
