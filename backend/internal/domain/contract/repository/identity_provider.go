package repository

import (
	"context"

	"backend/internal/domain/model"
)

// IdentityProvider is an outside service that signs a person in, such as Google.
type IdentityProvider interface {
	AuthorizationURL(state, nonce, verifier string) string
	// Verify exchanges the authorization code and checks what the provider returns.
	Verify(ctx context.Context, code, verifier, nonce string) (model.ProviderIdentity, error)
}
