package user

import (
	"context"

	"backend/internal/domain/model"
)

func (r *Repository) UpdateSettings(ctx context.Context, s model.UserSettings) error {
	const query = `
		INSERT INTO user_settings (user_id, theme, font_family, direction, language, notification_prefs, editor_prefs, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			theme = EXCLUDED.theme,
			font_family = EXCLUDED.font_family,
			direction = EXCLUDED.direction,
			language = EXCLUDED.language,
			notification_prefs = EXCLUDED.notification_prefs,
			editor_prefs = EXCLUDED.editor_prefs,
			updated_at = NOW()
	`
	_, err := r.db.ExecContext(ctx, query, s.UserID, s.Theme, s.FontFamily, s.Direction, s.Language, s.NotificationPrefs, s.EditorPrefs)
	return err
}
