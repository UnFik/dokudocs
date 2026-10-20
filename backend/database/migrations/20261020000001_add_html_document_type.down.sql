-- An enum value cannot be dropped; rebuild the type without it. Refuses while any
-- HTML document exists, so nothing is lost silently.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM documents WHERE type = 'html') THEN
        RAISE EXCEPTION 'html documents exist; delete them before rolling back';
    END IF;
END $$;

ALTER TYPE document_type RENAME TO document_type_with_html;
CREATE TYPE document_type AS ENUM ('markdown', 'dbdiagram', 'mermaid', 'architecture');
ALTER TABLE documents ALTER COLUMN type TYPE document_type USING type::text::document_type;
DROP TYPE document_type_with_html;
