DELETE FROM rag_embeddings e USING rag_embeddings keep
 WHERE e.chunk_id = keep.chunk_id AND (e.provider, e.model) > (keep.provider, keep.model);
ALTER TABLE rag_embeddings DROP CONSTRAINT rag_embeddings_pkey;
ALTER TABLE rag_embeddings ADD PRIMARY KEY (chunk_id);
DROP TABLE ai_provider_setting_changes;
DROP TABLE ai_provider_settings;
