-- Conversations that exist now keep the title they have; only new ones are titled by the model.
ALTER TABLE rag_conversations ADD COLUMN title_generated BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE rag_conversations ALTER COLUMN title_generated SET DEFAULT false;
