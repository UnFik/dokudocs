DROP TRIGGER IF EXISTS document_collab_states_bump_revision ON document_collab_states;
DROP FUNCTION IF EXISTS bump_document_collab_state_revision();
ALTER TABLE document_collab_states DROP COLUMN IF EXISTS revision;
