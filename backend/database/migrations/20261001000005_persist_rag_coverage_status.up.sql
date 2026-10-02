ALTER TABLE rag_messages
    ADD COLUMN coverage_partial BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN sources_may_be_incomplete BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE rag_message_citations
    ADD COLUMN document_title TEXT NOT NULL DEFAULT '',
    ADD COLUMN project_name TEXT NOT NULL DEFAULT '';
