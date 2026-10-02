package repository

import (
	"context"

	"backend/internal/domain/model"
)

type GoogleProvider interface {
	AuthorizationURL(state, nonce, verifier string) string
	Verify(ctx context.Context, code, verifier, nonce string) (model.GoogleIdentity, error)
}
