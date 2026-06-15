package constant

import "errors"

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrInvalidToken       = errors.New("invalid bearer token")
	ErrMissingCredential  = errors.New("email and password are required")
)
