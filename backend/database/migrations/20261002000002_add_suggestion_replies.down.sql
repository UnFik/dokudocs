DROP TABLE IF EXISTS document_suggestion_replies;
ALTER TABLE document_suggestions DROP COLUMN IF EXISTS resolved_by, DROP COLUMN IF EXISTS resolved_at;
