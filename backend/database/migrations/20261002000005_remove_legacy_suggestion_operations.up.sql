ALTER TABLE document_suggestions
    DROP COLUMN base_body_version,
    DROP COLUMN base_body_epoch,
    DROP COLUMN operation_schema_version,
    DROP COLUMN provenance,
    DROP COLUMN operations,
    DROP COLUMN summary,
    DROP COLUMN reason;
