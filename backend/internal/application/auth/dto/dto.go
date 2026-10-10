package dto

import (
	"time"

	"github.com/google/uuid"
)

type LoginRequest struct {
	Email    string
	Password string
}

type LoginResponse struct {
	AccessToken string
	User        ResponseUser
}

type ResponseUser struct {
	ID        string
	AccountNo string
	Email     string
	Role      []string
	Exp       int64
	// EmailVerified comes from the access token, not the database.
	EmailVerified bool
}

type RegisterRequest struct {
	Email    string
	Password string
	FullName string
}

type IdentityStart struct {
	Provider string
	Redirect string
	// LinkUserID is set when a signed-in User links an account instead of signing in.
	LinkUserID *uuid.UUID
}

type IdentityStarted struct {
	AuthorizationURL string
	// Binding is the secret the browser must hold until the exchange.
	Binding string
}

type IdentityCallback struct {
	Provider, State, Binding, Code, ProviderError string
}

// IdentityOutcome is what the callback decided; the handler turns it into a redirect.
type IdentityOutcome struct {
	// ExchangeCode is set when a sign-in succeeded.
	ExchangeCode string
	// Linked and Redirect describe a link attempt, which returns the User to Redirect.
	Linking  bool
	Redirect string
	// Error is a short code for the client: expired, denied, failed, identity_in_use, provider_linked.
	Error string
}

type IdentityExchange struct {
	Login    LoginResponse
	Redirect string
}

type LinkedIdentity struct {
	Provider string
	Email    string
	LinkedAt time.Time
}

type SignInMethods struct {
	HasPassword bool
	Identities  []LinkedIdentity
}
