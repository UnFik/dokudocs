ALTER TABLE document_revisions
    DROP CONSTRAINT IF EXISTS document_revisions_restore_receipt_complete,
    DROP CONSTRAINT IF EXISTS document_revisions_body_epoch_positive,
    DROP COLUMN IF EXISTS restore_source_revision_id,
    DROP COLUMN IF EXISTS body_epoch;
