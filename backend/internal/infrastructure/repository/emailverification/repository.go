package emailverification

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"backend/constant"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Repository struct {
	db database.Queryer
}

func NewRepository(db database.Queryer) *Repository {
	return &Repository{db: db}
}

// Issue must run in a transaction: it locks the User's row so two requests for
// the same User are handled one after the other.
func (r *Repository) Issue(ctx context.Context, userID uuid.UUID, tokenHash string, ttl, cooldown time.Duration) error {
	if _, err := r.db.ExecContext(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, userID); err != nil {
		return err
	}
	var recent bool
	if err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM email_verifications
			WHERE user_id = $1 AND consumed_at IS NULL AND created_at > now() - make_interval(secs => $2)
		)`, userID, cooldown.Seconds()).Scan(&recent); err != nil {
		return err
	}
	if recent {
		return constant.ErrVerificationTooSoon
	}
	if _, err := r.db.ExecContext(ctx, `DELETE FROM email_verifications WHERE user_id = $1 AND consumed_at IS NULL`, userID); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO email_verifications (user_id, token_hash, expires_at)
		VALUES ($1, $2, now() + make_interval(secs => $3))`, userID, tokenHash, ttl.Seconds())
	return err
}

func (r *Repository) Discard(ctx context.Context, tokenHash string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM email_verifications WHERE token_hash = $1`, tokenHash)
	return err
}

func (r *Repository) Consume(ctx context.Context, tokenHash string) (uuid.UUID, error) {
	var userID uuid.UUID
	err := r.db.QueryRowContext(ctx, `
		UPDATE email_verifications SET consumed_at = now()
		WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
		RETURNING user_id`, tokenHash).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, constant.ErrInvalidVerificationToken
	}
	return userID, err
}
