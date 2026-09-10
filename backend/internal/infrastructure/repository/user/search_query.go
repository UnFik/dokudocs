package user

import (
	"context"

	"backend/internal/domain/model"
)

func (r *Repository) Search(ctx context.Context, query string, limit int) ([]model.UserSummary, error) {
	if limit <= 0 {
		limit = 10
	}
	const q = `
		SELECT id, email, full_name, COALESCE(avatar_url, '')
		FROM users
		WHERE email ILIKE $1 OR full_name ILIKE $1
		ORDER BY full_name ASC
		LIMIT $2
	`
	rows, err := r.db.QueryContext(ctx, q, "%"+query+"%", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.UserSummary
	for rows.Next() {
		var u model.UserSummary
		if err := rows.Scan(&u.ID, &u.Email, &u.FullName, &u.AvatarURL); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}
