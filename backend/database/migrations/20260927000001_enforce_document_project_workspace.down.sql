ALTER TABLE documents
    DROP CONSTRAINT IF EXISTS documents_project_workspace_fkey;

DROP INDEX IF EXISTS projects_id_workspace_id_unique;
