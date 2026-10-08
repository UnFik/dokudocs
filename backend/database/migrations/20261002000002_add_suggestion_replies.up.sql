-- A suggestion is also a discussion thread: replies hang off it, and resolving
-- closes the thread without touching the suggestion's status or the body.
ALTER TABLE document_suggestions
    ADD COLUMN resolved_at TIMESTAMPTZ,
    ADD COLUMN resolved_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE document_suggestion_replies (
    document_id UUID NOT NULL,
    reply_id UUID NOT NULL,
    suggestion_id UUID NOT NULL,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (document_id, reply_id),
    FOREIGN KEY (document_id, suggestion_id)
        REFERENCES document_suggestions (document_id, suggestion_id) ON DELETE CASCADE,
    CONSTRAINT document_suggestion_replies_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000)
);

CREATE INDEX document_suggestion_replies_thread
    ON document_suggestion_replies (document_id, suggestion_id, created_at);
