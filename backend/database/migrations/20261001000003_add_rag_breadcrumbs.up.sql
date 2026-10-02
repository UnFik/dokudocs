ALTER TABLE rag_chunks
    ADD COLUMN breadcrumb TEXT NOT NULL DEFAULT '';

ALTER TABLE rag_message_citations
    ADD COLUMN breadcrumb TEXT NOT NULL DEFAULT '';

ALTER TABLE rag_document_indexes
    ALTER COLUMN renderer_version SET DEFAULT 2;

CREATE INDEX rag_chunks_breadcrumb_fts
    ON rag_chunks USING GIN (to_tsvector('simple', breadcrumb));
