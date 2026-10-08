-- An enum value cannot be dropped; rebuild the type without it. Refuses while any
-- Architecture document exists, so nothing is lost silently.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM documents WHERE type = 'architecture') THEN
        RAISE EXCEPTION 'architecture documents exist; delete them before rolling back';
    END IF;
END $$;

ALTER TYPE document_type RENAME TO document_type_with_architecture;
CREATE TYPE document_type AS ENUM ('markdown', 'dbdiagram', 'mermaid');
ALTER TABLE documents ALTER COLUMN type TYPE document_type USING type::text::document_type;
DROP TYPE document_type_with_architecture;
