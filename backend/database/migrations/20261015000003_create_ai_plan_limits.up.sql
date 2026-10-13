-- Tokens a User may use in one Workspace per calendar month, by the Workspace's Plan.
-- A Plan with no row here gets the Free limit.
CREATE TABLE ai_plan_limits (
    plan VARCHAR(50) PRIMARY KEY,
    monthly_tokens BIGINT NOT NULL CHECK (monthly_tokens > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ai_plan_limits (plan, monthly_tokens) VALUES
    ('Free', 300000),
    ('Pro', 3000000),
    ('Business', 15000000);

CREATE INDEX ai_model_usage_user_workspace_at ON ai_model_usage (user_id, workspace_id, at DESC);
