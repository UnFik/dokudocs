-- Calls recorded before this column existed have no measured time.
ALTER TABLE ai_model_usage ADD COLUMN duration_ms INTEGER;
