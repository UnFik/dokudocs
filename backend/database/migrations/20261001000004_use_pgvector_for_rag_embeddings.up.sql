CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE rag_embeddings DROP CONSTRAINT rag_embeddings_values_array;
ALTER TABLE rag_embeddings ALTER COLUMN values TYPE vector(1536) USING values::text::vector(1536);
ALTER TABLE rag_embeddings
    ADD CONSTRAINT rag_embeddings_dimensions_match CHECK (dimensions = 1536);
