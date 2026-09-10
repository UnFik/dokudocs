CREATE TABLE project_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    color_id VARCHAR(50) NOT NULL DEFAULT 'blue',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT idx_project_categories_unique_name UNIQUE (project_id, name)
);

CREATE INDEX idx_project_categories_order ON project_categories (project_id, sort_order);
