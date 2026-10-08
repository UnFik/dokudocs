-- The document is its Yjs state plus the ProseMirror JSON derived from it (documents.content_json).
-- The per-node AST rows, epochs and command receipts only served the old collaboration stack.
ALTER TABLE comment_threads DROP CONSTRAINT comment_threads_anchor_node_fk;
ALTER TABLE documents DROP CONSTRAINT documents_root_node_same_document_fk;

DROP TABLE document_command_receipts;
DROP TABLE document_nodes;

ALTER TABLE documents
    DROP COLUMN root_node_id,
    DROP COLUMN body_epoch,
    DROP COLUMN body_schema_version,
    DROP COLUMN compat_epoch;

ALTER TABLE document_revisions DROP CONSTRAINT document_revisions_restore_receipt_complete;
ALTER TABLE document_revisions RENAME COLUMN ast_snapshot TO content_json;
ALTER TABLE document_revisions
    DROP COLUMN body_schema_version,
    DROP COLUMN body_epoch,
    ADD CONSTRAINT document_revisions_restore_receipt_complete CHECK (
        (restore_request_id IS NULL AND restore_source_revision_id IS NULL)
        OR (restore_request_id IS NOT NULL AND restore_source_revision_id IS NOT NULL)
    );

DROP TRIGGER document_collab_states_bump_revision ON document_collab_states;
DROP FUNCTION bump_document_collab_state_revision();
ALTER TABLE document_collab_states
    DROP COLUMN revision,
    DROP COLUMN schema_version;

ALTER TABLE rag_document_indexes DROP COLUMN indexed_body_epoch;
