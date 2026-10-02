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
)
