package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
)

const (
	PurposeSignIn = "sign_in"
	PurposeLink   = "link"
)

type NewOAuthTransaction struct {
	Provider, Purpose, StateHash, BindingHash string
	Nonce, CodeVerifier, RedirectPath         string
	// UserID is whoever is linking an account; nil when signing in.
	UserID *uuid.UUID
}

type OAuthTransaction struct {
	ID                                uuid.UUID
	Provider, Purpose                 string
	Nonce, CodeVerifier, RedirectPath string
	UserID                            *uuid.UUID
}

// OAuthTransactionRepository keeps one sign-in or link attempt from start to
// exchange. Each step is a single conditional UPDATE, so a step can only happen
// once however many requests race for it, and every time check uses the
// database clock.
type OAuthTransactionRepository interface {
	// Purge deletes the attempts that have expired.
	Purge(ctx context.Context) error
	Create(ctx context.Context, tx NewOAuthTransaction, ttl time.Duration) error
	// Claim moves a started attempt to claimed, if the browser holds the binding;
	// otherwise it gives constant.ErrOAuthTransactionNotFound and changes nothing.
	Claim(ctx context.Context, stateHash, bindingHash string) (OAuthTransaction, error)
	// Complete stores the exchange code of a claimed attempt and who it signs in.
	Complete(ctx context.Context, id, userID uuid.UUID, exchangeCodeHash string, ttl time.Duration) error
	// Finish closes a claimed attempt that ends without an exchange code.
	Finish(ctx context.Context, id uuid.UUID) error
	// Exchange consumes a completed attempt for the browser that holds the binding.
	Exchange(ctx context.Context, codeHash, bindingHash string) (userID uuid.UUID, redirectPath string, err error)
}
