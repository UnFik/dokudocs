-- Files added to a page. The bytes are in the asset store; this is what is known about them.
CREATE TABLE document_assets (
    id            uuid PRIMARY KEY,
    document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    file_name     text NOT NULL,
    content_type  text NOT NULL,
    size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
    sha256        text NOT NULL,
    store_key     text NOT NULL UNIQUE,
    created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX document_assets_document_idx ON document_assets (document_id, created_at);
