CREATE TABLE ai_run_events (
 run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
 sequence bigint NOT NULL,
 type text NOT NULL,
 data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (run_id,sequence)
);
