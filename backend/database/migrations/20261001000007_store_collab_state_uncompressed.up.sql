-- Yjs state is rewritten on every collaborative commit and compresses poorly;
-- skipping pglz compression saves CPU on that hot write.
ALTER TABLE document_collab_states ALTER COLUMN encoded_state SET STORAGE EXTERNAL;
