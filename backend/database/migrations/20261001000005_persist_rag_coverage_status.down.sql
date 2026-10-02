ALTER TABLE rag_messages
    DROP COLUMN sources_may_be_incomplete,
    DROP COLUMN coverage_partial;

ALTER TABLE rag_message_citations
    DROP COLUMN project_name,
    DROP COLUMN document_title;
