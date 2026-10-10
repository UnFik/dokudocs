package repository

import (
	"context"
	"io"

	"github.com/google/uuid"
)

// AvatarRepository keeps which picture a User shows.
type AvatarRepository interface {
	// SetAvatar stores the url (empty clears it) and returns the one it replaced.
	SetAvatar(ctx context.Context, id uuid.UUID, url string) (previous string, err error)
}

// AvatarStore keeps the picture files; a key looks like `avatars/<name>`.
type AvatarStore interface {
	Put(ctx context.Context, key string, body io.Reader) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}
