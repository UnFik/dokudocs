CREATE TABLE document_category_mappings (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES project_categories(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (document_id, category_id)
);

CREATE INDEX idx_doc_cat_category ON document_category_mappings (category_id);
