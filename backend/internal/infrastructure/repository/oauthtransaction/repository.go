package oauthtransaction

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"backend/constant"
	repocontract "backend/internal/domain/contract/repository"
	"backend/internal/infrastructure/database"

	"github.com/google/uuid"
)

type Repository struct {
	db database.Queryer
}

func NewRepository(db database.Queryer) *Repository { return &Repository{db: db} }

func (r *Repository) Purge(ctx context.Context) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM oauth_transactions WHERE expires_at < now()`)
	return err
}

func (r *Repository) Create(ctx context.Context, tx repocontract.NewOAuthTransaction, ttl time.Duration) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO oauth_transactions
			(provider, purpose, state_hash, binding_hash, nonce, code_verifier, redirect_path, user_id, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(secs => $9))`,
		tx.Provider, tx.Purpose, tx.StateHash, tx.BindingHash, tx.Nonce, tx.CodeVerifier, tx.RedirectPath, tx.UserID, ttl.Seconds())
	return err
}

func (r *Repository) Claim(ctx context.Context, stateHash, bindingHash string) (repocontract.OAuthTransaction, error) {
	var t repocontract.OAuthTransaction
	var userID uuid.NullUUID
	err := r.db.QueryRowContext(ctx, `
		UPDATE oauth_transactions SET status = 'claimed'
		WHERE state_hash = $1 AND binding_hash = $2 AND status = 'started' AND expires_at > now()
		RETURNING id, provider, purpose, nonce, code_verifier, redirect_path, user_id`, stateHash, bindingHash,
	).Scan(&t.ID, &t.Provider, &t.Purpose, &t.Nonce, &t.CodeVerifier, &t.RedirectPath, &userID)
	if errors.Is(err, sql.ErrNoRows) {
		return t, constant.ErrOAuthTransactionNotFound
	}
	if userID.Valid {
		t.UserID = &userID.UUID
	}
	return t, err
}

func (r *Repository) Complete(ctx context.Context, id, userID uuid.UUID, exchangeCodeHash string, ttl time.Duration) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE oauth_transactions
		SET status = 'completed', user_id = $2, exchange_code_hash = $3, expires_at = now() + make_interval(secs => $4)
		WHERE id = $1 AND status = 'claimed'`, id, userID, exchangeCodeHash, ttl.Seconds())
	return mustChangeOne(result, err)
}

func (r *Repository) Finish(ctx context.Context, id uuid.UUID) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE oauth_transactions SET status = 'consumed', consumed_at = now() WHERE id = $1 AND status = 'claimed'`, id)
	return mustChangeOne(result, err)
}

func (r *Repository) Exchange(ctx context.Context, codeHash, bindingHash string) (uuid.UUID, string, error) {
	var userID uuid.UUID
	var redirect string
	err := r.db.QueryRowContext(ctx, `
		UPDATE oauth_transactions SET status = 'consumed', consumed_at = now()
		WHERE exchange_code_hash = $1 AND binding_hash = $2 AND status = 'completed' AND expires_at > now()
		RETURNING user_id, redirect_path`, codeHash, bindingHash).Scan(&userID, &redirect)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, "", constant.ErrOAuthTransactionNotFound
	}
	return userID, redirect, err
}

func mustChangeOne(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return constant.ErrOAuthTransactionNotFound
	}
	return nil
}
