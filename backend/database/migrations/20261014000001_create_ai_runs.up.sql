CREATE TABLE ai_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
 conversation_id uuid REFERENCES rag_conversations(conversation_id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('chat','test','save')),
 idempotency_key text NOT NULL,
 fingerprint text NOT NULL,
 instance_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled','interrupted')),
 draft text NOT NULL DEFAULT '',
 sequence bigint NOT NULL DEFAULT 0,
 result jsonb,
 error text NOT NULL DEFAULT '',
 started_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deadline timestamptz NOT NULL,
 lease_until timestamptz NOT NULL DEFAULT now() + interval '30 seconds',
 UNIQUE (owner_id,idempotency_key)
);
CREATE UNIQUE INDEX ai_runs_one_active_conversation ON ai_runs(conversation_id) WHERE status='running' AND conversation_id IS NOT NULL;
CREATE INDEX ai_runs_conversation_history ON ai_runs(conversation_id,started_at DESC);
CREATE INDEX ai_runs_recovery ON ai_runs(lease_until) WHERE status='running';
