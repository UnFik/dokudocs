-- One row per purpose. 'embedding_pending' holds a new embedding model while documents
-- are re-embedded; the 'embedding' row stays active until that finishes.
CREATE TABLE ai_provider_settings (
    purpose TEXT PRIMARY KEY CHECK (purpose IN ('answer', 'embedding', 'embedding_pending')),
    base_url TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK (protocol IN ('openai_responses', 'openai_chat_completions')),
    model TEXT NOT NULL CHECK (btrim(model) <> ''),
    api_key_ciphertext BYTEA NOT NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT NOT NULL DEFAULT '',
    last_error_at TIMESTAMPTZ
);

-- The API key is never written here, only the fact that it was replaced.
CREATE TABLE ai_provider_setting_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose TEXT NOT NULL,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changes JSONB NOT NULL
);

CREATE INDEX ai_provider_setting_changes_changed_at ON ai_provider_setting_changes (changed_at DESC);

-- A chunk keeps one vector per model, so two models can coexist while one replaces the other.
ALTER TABLE rag_embeddings DROP CONSTRAINT rag_embeddings_pkey;
ALTER TABLE rag_embeddings ADD PRIMARY KEY (chunk_id, provider, model);
