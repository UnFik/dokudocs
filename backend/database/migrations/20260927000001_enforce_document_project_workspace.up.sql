CREATE UNIQUE INDEX projects_id_workspace_id_unique
    ON projects (id, workspace_id);

ALTER TABLE documents
    ADD CONSTRAINT documents_project_workspace_fkey
    FOREIGN KEY (project_id, workspace_id)
    REFERENCES projects (id, workspace_id)
    NOT VALID;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM documents d
        JOIN projects p ON p.id = d.project_id
        WHERE d.workspace_id <> p.workspace_id
    ) THEN
        RAISE EXCEPTION 'documents contain project/workspace mismatches; repair them before validating documents_project_workspace_fkey';
    END IF;
END $$;

ALTER TABLE documents VALIDATE CONSTRAINT documents_project_workspace_fkey;
