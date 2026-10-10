DROP INDEX IF EXISTS uq_notifications_open_mention;
ALTER TABLE notifications
    DROP COLUMN IF EXISTS delivered_at,
    DROP COLUMN IF EXISTS comment_id,
    DROP COLUMN IF EXISTS thread_id,
    DROP COLUMN IF EXISTS document_id,
    DROP COLUMN IF EXISTS workspace_id;
