package user

import (
	"context"

	"backend/internal/domain/model"

	"github.com/google/uuid"
)

func (r *Repository) GetSettings(ctx context.Context, userID uuid.UUID) (model.UserSettings, error) {
	const query = `
		SELECT user_id, theme, font_family, direction, language, notification_prefs, editor_prefs, updated_at
		FROM user_settings
		WHERE user_id = $1
	`
	var s model.UserSettings
	err := r.db.QueryRowContext(ctx, query, userID).Scan(
		&s.UserID, &s.Theme, &s.FontFamily, &s.Direction, &s.Language,
		&s.NotificationPrefs, &s.EditorPrefs, &s.UpdatedAt,
	)
	return s, err
}
