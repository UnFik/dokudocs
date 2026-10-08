-- The record a collaboration room writes to. Only a body replacement (a restored
-- revision) changes it; ordinary saves advance body_version instead. A room or a
-- device copy made for an older record must not write over the current one.
ALTER TABLE documents ADD COLUMN body_replacement_id UUID NOT NULL DEFAULT gen_random_uuid();

-- The record a restore made, so a retried restore answers with the same one.
ALTER TABLE document_revisions ADD COLUMN restore_replacement_id UUID;
