package user

import (
	"context"

	"github.com/google/uuid"
)

func (r *Repository) SetAvatar(ctx context.Context, id uuid.UUID, url string) (string, error) {
	const query = `
		WITH old AS (SELECT COALESCE(avatar_url, '') AS url FROM users WHERE id = $1 FOR UPDATE)
		UPDATE users SET avatar_url = NULLIF($2, ''), updated_at = NOW()
		FROM old WHERE users.id = $1
		RETURNING old.url`
	var previous string
	err := r.db.QueryRowContext(ctx, query, id, url).Scan(&previous)
	return previous, err
}
