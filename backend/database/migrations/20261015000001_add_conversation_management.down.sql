ALTER TABLE rag_conversations
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS pinned_at;
