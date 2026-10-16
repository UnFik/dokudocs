-- A trace is how one Agent request went through the decision graph: codes, counts and
-- names, never what a User wrote. It has its own life: it is kept after the run's draft
-- and result are gone, and it goes with the User or workspace it belongs to.
CREATE TABLE ai_run_traces (
    run_id UUID PRIMARY KEY,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    conversation_id UUID,
    started_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ai_run_traces_started ON ai_run_traces (started_at DESC);
CREATE INDEX ai_run_traces_owner ON ai_run_traces (owner_id, started_at DESC);
CREATE INDEX ai_run_traces_workspace ON ai_run_traces (workspace_id, started_at DESC);

CREATE TABLE ai_run_steps (
    run_id UUID NOT NULL REFERENCES ai_run_traces(run_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    node TEXT NOT NULL,
    edge TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    model TEXT NOT NULL DEFAULT '',
    tier TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    finish_reason TEXT NOT NULL DEFAULT '',
    tool TEXT NOT NULL DEFAULT '',
    attempt INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (run_id, seq)
);
CREATE INDEX ai_run_steps_node ON ai_run_steps (node);

-- One row of Superadmin controls for the Agent's entry gate, model router and traces.
CREATE TABLE ai_harness_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    gate_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    router_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    trace_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (trace_retention_days BETWEEN 1 AND 365),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO ai_harness_settings (id) VALUES (1);
