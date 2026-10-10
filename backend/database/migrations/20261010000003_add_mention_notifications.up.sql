-- A notification can point at the comment it is about, so a click opens it, and
-- remembers when email and push were last sent for it.
ALTER TABLE notifications
    ADD COLUMN workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    ADD COLUMN document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    ADD COLUMN thread_id UUID REFERENCES comment_threads(id) ON DELETE CASCADE,
    -- The thread for its first message, or the reply.
    ADD COLUMN comment_id UUID,
    ADD COLUMN delivered_at TIMESTAMPTZ;

-- One open notification per person and message: editing the message updates it.
CREATE UNIQUE INDEX uq_notifications_open_mention
    ON notifications (user_id, comment_id)
    WHERE kind = 'comment_mention' AND read_at IS NULL;
