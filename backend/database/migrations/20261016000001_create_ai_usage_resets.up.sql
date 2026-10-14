-- A Superadmin's reset of one User's allowance in one Workspace. Usage rows stay;
-- the month's count starts again from reset_at.
CREATE TABLE ai_usage_resets (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, workspace_id)
);
