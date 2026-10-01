ALTER TABLE document_revisions
    ADD COLUMN body_epoch BIGINT,
    ADD COLUMN restore_source_revision_id UUID,
    ADD CONSTRAINT document_revisions_body_epoch_positive
        CHECK (body_epoch IS NULL OR body_epoch > 0),
    ADD CONSTRAINT document_revisions_restore_receipt_complete CHECK (
        (restore_request_id IS NULL AND restore_source_revision_id IS NULL AND body_epoch IS NULL)
        OR (restore_request_id IS NOT NULL AND restore_source_revision_id IS NOT NULL AND body_epoch IS NOT NULL)
    );
