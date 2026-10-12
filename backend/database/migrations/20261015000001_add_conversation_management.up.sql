ALTER TABLE rag_conversations
    ADD COLUMN pinned_at TIMESTAMPTZ,
    ADD COLUMN archived_at TIMESTAMPTZ;
