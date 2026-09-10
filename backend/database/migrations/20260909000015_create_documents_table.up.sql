CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL DEFAULT 'Untitled Document',
    type document_type NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    is_draft BOOLEAN NOT NULL DEFAULT FALSE,
    visibility document_visibility NOT NULL DEFAULT 'inherit',
    share_token VARCHAR(64) UNIQUE,
    thumbnail TEXT,
    thumbnail_dark TEXT,
    thumbnail_preview TEXT,
    thumbnail_preview_dark TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_docs_workspace ON documents (workspace_id);
CREATE INDEX idx_docs_project ON documents (project_id);
CREATE INDEX idx_docs_author_draft ON documents (workspace_id, author_id);
CREATE INDEX idx_docs_share_token ON documents (share_token);
