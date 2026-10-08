ALTER TABLE document_suggestions
    ADD COLUMN base_body_version BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN base_body_epoch BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN operation_schema_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN provenance TEXT NOT NULL DEFAULT 'human',
    ADD COLUMN operations JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN summary TEXT NOT NULL DEFAULT '',
    ADD COLUMN reason TEXT NOT NULL DEFAULT '';

ALTER TABLE document_suggestions
    ALTER COLUMN base_body_version DROP DEFAULT,
    ALTER COLUMN base_body_epoch DROP DEFAULT,
    ALTER COLUMN provenance DROP DEFAULT,
    ALTER COLUMN operations DROP DEFAULT;

ALTER TABLE document_suggestions
    ADD CONSTRAINT document_suggestions_body_version_positive CHECK (base_body_version > 0),
    ADD CONSTRAINT document_suggestions_body_epoch_positive CHECK (base_body_epoch > 0),
    ADD CONSTRAINT document_suggestions_operation_schema_positive CHECK (operation_schema_version > 0),
    ADD CONSTRAINT document_suggestions_provenance_valid CHECK (provenance IN ('human', 'AI'));
