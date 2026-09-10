CREATE TABLE document_views (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    view_count INT NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, document_id)
);

CREATE INDEX idx_doc_views_recent ON document_views (user_id, last_viewed_at);
