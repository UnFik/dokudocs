-- The JSON form of a document (ProseMirror JSON), derived from its Yjs state by the
-- collaboration service each time it stores the state. Search, export, duplicate and
-- the RAG index read this instead of the per-node AST rows.
ALTER TABLE documents ADD COLUMN content_json JSONB;
