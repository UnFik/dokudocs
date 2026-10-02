-- Every write to a document's Yjs state bumps its revision, so a server can
-- tell from one small column whether its cached copy of the state is current.
ALTER TABLE document_collab_states ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;

CREATE FUNCTION bump_document_collab_state_revision() RETURNS trigger AS $$
BEGIN
    NEW.revision := OLD.revision + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_collab_states_bump_revision
    BEFORE UPDATE ON document_collab_states
    FOR EACH ROW EXECUTE FUNCTION bump_document_collab_state_revision();
