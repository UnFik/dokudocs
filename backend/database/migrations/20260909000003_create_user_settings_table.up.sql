CREATE TABLE user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme VARCHAR(20) NOT NULL DEFAULT 'system',
    font_family VARCHAR(50) NOT NULL DEFAULT 'inter',
    direction VARCHAR(10) NOT NULL DEFAULT 'ltr',
    language VARCHAR(10) NOT NULL DEFAULT 'en',
    notification_prefs JSONB NOT NULL DEFAULT '{"email": true, "in_app": true}',
    editor_prefs JSONB NOT NULL DEFAULT '{"view_mode": "split", "split_percent": 50, "is_live_render": true, "sync_scroll": true, "show_outline": false, "preview_mode": "view"}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
