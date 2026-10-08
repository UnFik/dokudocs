-- Which documents each element of an Architecture document links to. Derived from
-- the canvas on every store (ADR 0031); rebuilt from content_json at will.
CREATE TABLE architecture_document_links (
    architecture_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    element_id      TEXT NOT NULL,
    element_kind    TEXT NOT NULL CHECK (element_kind IN ('system', 'connection')),
    element_name    TEXT NOT NULL DEFAULT '',
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY (architecture_id, element_id, document_id)
);

CREATE INDEX idx_architecture_document_links_document ON architecture_document_links (document_id);
