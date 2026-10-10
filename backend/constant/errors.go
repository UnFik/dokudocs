package constant

import "errors"

var (
	ErrInvalidCredentials    = errors.New("invalid email or password")
	ErrInvalidToken          = errors.New("invalid bearer token")
	ErrMissingCredential     = errors.New("email and password are required")
	ErrInvalidRegistration   = errors.New("invalid registration data")
	ErrMemberRoleNotFound    = errors.New("member role not found")
	ErrUserNotFound          = errors.New("user not found")
	ErrEmailAlreadyExists    = errors.New("email already registered")
	ErrWorkspaceNotFound     = errors.New("workspace not found")
	ErrProjectNotFound       = errors.New("project not found")
	ErrCategoryNotFound      = errors.New("category not found")
	ErrDocumentNotFound      = errors.New("document not found")
	ErrDocumentConflict      = errors.New("document changed; retry the update")
	ErrInvalidIdempotencyKey = errors.New("invalid idempotency key")
	ErrAccessNotFound        = errors.New("document access not found")
	ErrUnauthorized          = errors.New("unauthorized")
	ErrForbidden             = errors.New("forbidden")

	ErrInvalidVerificationToken = errors.New("verification link is invalid or has expired")
	ErrVerificationTooSoon      = errors.New("a verification email was sent a moment ago")
	ErrEmailNotConfigured       = errors.New("email sending is not configured")
	ErrEmailNotSent             = errors.New("verification email could not be sent")

	ErrIdentityNotFound         = errors.New("sign-in identity not linked")
	ErrIdentityInUse            = errors.New("this account is linked to another user")
	ErrProviderAlreadyLinked    = errors.New("a different account from this provider is already linked")
	ErrOAuthTransactionNotFound = errors.New("sign-in attempt not found or expired")
	ErrIdentityProviderNotSet   = errors.New("sign-in provider is not configured")
	ErrIdentityEmailNotVerified = errors.New("the provider has not verified this email")
	ErrLastSignInMethod         = errors.New("this is the only way to sign in")
	ErrPasswordAlreadySet       = errors.New("a password is already set")
	ErrInvalidPassword          = errors.New("password must be at least 15 characters and at most 72 bytes")
)
