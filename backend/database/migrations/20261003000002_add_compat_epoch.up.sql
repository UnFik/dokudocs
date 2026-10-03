-- The oldest body epoch whose collaborative history still continues into the
-- current one (ADR 0028). Structural commands that edit the stored state in
-- place raise body_epoch and leave this alone; a rebuild, such as restoring a
-- revision, sets it to the new epoch. Existing documents start at their current
-- epoch, so no older update is accepted that was not accepted before.
ALTER TABLE documents
    ADD COLUMN compat_epoch BIGINT NOT NULL DEFAULT 1;

UPDATE documents SET compat_epoch = body_epoch;

ALTER TABLE documents
    ADD CONSTRAINT documents_compat_epoch_range CHECK (compat_epoch >= 1 AND compat_epoch <= body_epoch);
