ALTER TABLE rag_embeddings DROP CONSTRAINT rag_embeddings_dimensions_match;
ALTER TABLE rag_embeddings ALTER COLUMN values TYPE JSONB USING values::text::jsonb;
ALTER TABLE rag_embeddings
    ADD CONSTRAINT rag_embeddings_values_array CHECK (jsonb_typeof(values) = 'array');
