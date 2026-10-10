package passwordtoken

import (
	"context"
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
			SELECT 1 FROM password_tokens
			WHERE user_id = $1 AND consumed_at IS NULL AND created_at > now() - make_interval(secs => $2)
		)`, userID, cooldown.Seconds()).Scan(&recent); err != nil {
		return err
	}
	if recent {
		return constant.ErrPasswordLinkTooSoon
	}
	if _, err := r.db.ExecContext(ctx, `DELETE FROM password_tokens WHERE user_id = $1 AND consumed_at IS NULL`, userID); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO password_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, now() + make_interval(secs => $3))`, userID, tokenHash, ttl.Seconds())
	return err
}

func (r *Repository) Discard(ctx context.Context, tokenHash string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM password_tokens WHERE token_hash = $1`, tokenHash)
	return err
}

func (r *Repository) Check(ctx context.Context, userID uuid.UUID, tokenHash string) error {
	var usable bool
	if err := r.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM password_tokens
			WHERE token_hash = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > now()
		)`, tokenHash, userID).Scan(&usable); err != nil {
		return err
	}
	if !usable {
		return constant.ErrInvalidPasswordLink
	}
	return nil
}

func (r *Repository) Consume(ctx context.Context, userID uuid.UUID, tokenHash string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE password_tokens SET consumed_at = now()
		WHERE token_hash = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > now()`, tokenHash, userID)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return constant.ErrInvalidPasswordLink
	}
	return nil
}
