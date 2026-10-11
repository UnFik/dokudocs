DROP INDEX IF EXISTS idx_workspace_invites_email;
DROP INDEX IF EXISTS workspace_invites_pending_unique;

ALTER TABLE workspace_invites
    DROP CONSTRAINT IF EXISTS workspace_invites_email_lower,
    DROP CONSTRAINT IF EXISTS workspace_invites_role_not_owner,
    DROP COLUMN IF EXISTS last_sent_at,
    DROP COLUMN IF EXISTS revoked_at,
    DROP COLUMN IF EXISTS accepted_by,
    DROP COLUMN IF EXISTS accepted_at;

ALTER TABLE workspace_invites RENAME COLUMN token_hash TO token;
