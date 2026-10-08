ALTER TABLE documents
    DROP CONSTRAINT documents_compat_epoch_range;

ALTER TABLE documents
    DROP COLUMN compat_epoch;
