-- What the Agent may do for each User (ADR 0044). No row means only reading.
CREATE TABLE ai_permissions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    capabilities TEXT[] NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A third provider setting: the model the Agent thinks and calls tools with.
ALTER TABLE ai_provider_settings DROP CONSTRAINT ai_provider_settings_purpose_check;
ALTER TABLE ai_provider_settings ADD CONSTRAINT ai_provider_settings_purpose_check
    CHECK (purpose IN ('answer', 'embedding', 'embedding_pending', 'agent'));

-- One row per call to a Dokudocs model. Counts only, never content.
CREATE TABLE ai_model_usage (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    feature TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    ok BOOLEAN NOT NULL
);
CREATE INDEX ai_model_usage_at ON ai_model_usage (at DESC);

-- A Conversation on one document. No foreign key: the history outlives the document (ADR 0004).
ALTER TABLE rag_conversations ADD COLUMN document_id UUID;
CREATE INDEX rag_conversations_creator_document ON rag_conversations (creator_id, document_id, updated_at DESC);
ALTER TABLE rag_messages ADD COLUMN meta JSONB NOT NULL DEFAULT '{}'::jsonb;

-- An action the Agent asked for in chat, waiting for the User (ADR 0043).
CREATE TABLE agent_pending_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES rag_conversations(conversation_id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tool TEXT NOT NULL,
    arguments JSONB NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'failed')),
    result TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ
);
CREATE INDEX agent_pending_actions_conversation ON agent_pending_actions (conversation_id, created_at);

-- Suggestions the Agent wrote, so the review rail can say AI assisted.
CREATE TABLE ai_assisted_suggestions (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    suggestion_id UUID NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('chat', 'mcp')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (document_id, suggestion_id)
);

-- MCP API keys (ADR 0045). Only a hash of the key is kept.
CREATE TABLE mcp_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mcp_api_keys_user ON mcp_api_keys (user_id, created_at DESC);

-- The Superadmin's brake and limits for MCP; one row.
CREATE TABLE mcp_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    read_per_minute INTEGER NOT NULL DEFAULT 60 CHECK (read_per_minute > 0),
    write_per_minute INTEGER NOT NULL DEFAULT 10 CHECK (write_per_minute > 0),
    max_result_bytes INTEGER NOT NULL DEFAULT 204800 CHECK (max_result_bytes >= 1024),
    audit_retention_days INTEGER NOT NULL DEFAULT 90 CHECK (audit_retention_days > 0),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO mcp_settings (id) VALUES (1);

-- Every MCP call: who, which tool, on what, and how it ended. Never content.
CREATE TABLE mcp_audit (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    key_id UUID REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tool TEXT NOT NULL,
    resource TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'limited', 'error')),
    detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX mcp_audit_at ON mcp_audit (at DESC);
CREATE INDEX mcp_audit_user ON mcp_audit (user_id, at DESC);

-- Skills: instructions a Superadmin writes for every User.
CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE CHECK (name ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
    description TEXT NOT NULL DEFAULT '',
    instructions TEXT NOT NULL CHECK (btrim(instructions) <> ''),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
