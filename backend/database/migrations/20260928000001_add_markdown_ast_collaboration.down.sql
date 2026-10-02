DROP INDEX IF EXISTS document_revisions_restore_request_unique;
ALTER TABLE document_revisions
    DROP COLUMN IF EXISTS restore_request_id,
    DROP COLUMN IF EXISTS body_schema_version,
    DROP COLUMN IF EXISTS body_version,
    DROP COLUMN IF EXISTS ast_snapshot;

DROP INDEX IF EXISTS comment_threads_anchor_node;
ALTER TABLE comment_threads
    DROP CONSTRAINT IF EXISTS comment_threads_anchor_node_fk,
    DROP CONSTRAINT IF EXISTS comment_threads_anchor_state_valid,
    DROP COLUMN IF EXISTS anchor_state,
    DROP COLUMN IF EXISTS anchor_end,
    DROP COLUMN IF EXISTS anchor_start,
    DROP COLUMN IF EXISTS anchor_node_id;

DROP TABLE IF EXISTS document_command_receipts;
DROP TABLE IF EXISTS document_collab_states;

ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_root_node_same_document_fk;
DROP TABLE IF EXISTS document_nodes;

DROP INDEX IF EXISTS documents_creation_request_unique;
ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_creation_request_complete,
    DROP CONSTRAINT IF EXISTS documents_body_schema_version_positive,
    DROP CONSTRAINT IF EXISTS documents_body_epoch_positive,
    DROP CONSTRAINT IF EXISTS documents_body_version_positive,
    DROP COLUMN IF EXISTS creation_request_hash,
    DROP COLUMN IF EXISTS creation_request_id,
    DROP COLUMN IF EXISTS creation_request_kind,
    DROP COLUMN IF EXISTS body_schema_version,
    DROP COLUMN IF EXISTS body_epoch,
    DROP COLUMN IF EXISTS body_version,
    DROP COLUMN IF EXISTS root_node_id;
