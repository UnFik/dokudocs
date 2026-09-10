CREATE TABLE document_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    version_number INT NOT NULL,
    title VARCHAR(255),
    content TEXT NOT NULL,
    is_named BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT idx_doc_revisions_version UNIQUE (document_id, version_number)
);

CREATE INDEX idx_doc_revisions_history ON document_revisions (document_id, version_number);
