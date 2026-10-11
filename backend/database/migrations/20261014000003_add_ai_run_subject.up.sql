ALTER TABLE ai_runs ADD COLUMN subject text NOT NULL DEFAULT '';
CREATE INDEX ai_runs_owner_subject ON ai_runs(owner_id,kind,subject,started_at DESC) WHERE subject <> '';
