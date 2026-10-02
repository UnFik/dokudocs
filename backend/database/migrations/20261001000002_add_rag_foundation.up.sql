CREATE TABLE rag_document_indexes (
    document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    indexed_body_version BIGINT NOT NULL,
    indexed_body_epoch BIGINT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    indexed_title TEXT NOT NULL DEFAULT '',
    indexed_project_id UUID,
    indexed_project_name TEXT NOT NULL DEFAULT '',
    renderer_version INTEGER NOT NULL DEFAULT 1,
    coverage_status TEXT NOT NULL DEFAULT 'complete',
    skipped_node_count INTEGER NOT NULL DEFAULT 0,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rag_document_indexes_versions_positive CHECK (indexed_body_version > 0 AND indexed_body_epoch > 0),
    CONSTRAINT rag_document_indexes_coverage_valid CHECK (coverage_status IN ('complete', 'partial')),
    CONSTRAINT rag_document_indexes_skipped_nonnegative CHECK (skipped_node_count >= 0)
);

CREATE TABLE rag_chunks (
    chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id UUID NOT NULL,
    ordinal INTEGER NOT NULL,
    body_version BIGINT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    text TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    project_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rag_chunks_ordinal_nonnegative CHECK (ordinal >= 0),
    CONSTRAINT rag_chunks_body_version_positive CHECK (body_version > 0),
    CONSTRAINT rag_chunks_text_nonempty CHECK (length(trim(text)) > 0),
    CONSTRAINT rag_chunks_source_fingerprint_nonempty CHECK (source_fingerprint <> '')
);

CREATE UNIQUE INDEX rag_chunks_document_ordinal ON rag_chunks(document_id, ordinal);
CREATE INDEX rag_chunks_document_node ON rag_chunks(document_id, node_id);
CREATE INDEX rag_chunks_text_fts ON rag_chunks USING GIN (to_tsvector('simple', text));
CREATE INDEX rag_chunks_title_fts ON rag_chunks USING GIN (to_tsvector('simple', title));

CREATE TABLE rag_embeddings (
    chunk_id UUID PRIMARY KEY REFERENCES rag_chunks(chunk_id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    values JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rag_embeddings_dimensions_positive CHECK (dimensions > 0),
    CONSTRAINT rag_embeddings_values_array CHECK (jsonb_typeof(values) = 'array')
);

CREATE TABLE rag_conversations (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX rag_conversations_creator_updated ON rag_conversations(creator_id, updated_at DESC);

CREATE TABLE rag_messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES rag_conversations(conversation_id) ON DELETE CASCADE,
    sequence_no BIGINT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rag_messages_role_valid CHECK (role IN ('user', 'assistant')),
    CONSTRAINT rag_messages_content_nonempty CHECK (length(trim(content)) > 0),
    CONSTRAINT rag_messages_sequence_positive CHECK (sequence_no > 0),
    CONSTRAINT rag_messages_conversation_sequence_unique UNIQUE (conversation_id, sequence_no)
);

CREATE INDEX rag_messages_conversation_created ON rag_messages(conversation_id, sequence_no);

CREATE TABLE rag_message_citations (
    message_id UUID NOT NULL REFERENCES rag_messages(message_id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES rag_chunks(chunk_id) ON DELETE SET NULL,
    node_id UUID NOT NULL,
    body_version BIGINT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    quoted_text TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    PRIMARY KEY (message_id, ordinal),
    CONSTRAINT rag_message_citations_ordinal_nonnegative CHECK (ordinal >= 0),
    CONSTRAINT rag_message_citations_version_positive CHECK (body_version > 0),
    CONSTRAINT rag_message_citations_quote_nonempty CHECK (length(trim(quoted_text)) > 0)
);

CREATE INDEX rag_message_citations_document ON rag_message_citations(document_id);
