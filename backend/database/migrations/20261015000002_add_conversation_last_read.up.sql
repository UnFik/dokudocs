-- Rows that exist now count as read, so nobody opens the panel to a wall of badges.
ALTER TABLE rag_conversations
    ADD COLUMN last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
