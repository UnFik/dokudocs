UPDATE rag_document_indexes SET renderer_version = 0;

DROP INDEX rag_chunks_breadcrumb_fts;

ALTER TABLE rag_document_indexes
    ALTER COLUMN renderer_version SET DEFAULT 1;

ALTER TABLE rag_message_citations
    DROP COLUMN breadcrumb;

ALTER TABLE rag_chunks
    DROP COLUMN breadcrumb;
