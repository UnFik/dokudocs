ALTER TABLE workspace_invites RENAME COLUMN token TO token_hash;

ALTER TABLE workspace_invites
    ADD COLUMN accepted_at TIMESTAMPTZ,
    ADD COLUMN accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN revoked_at TIMESTAMPTZ,
    ADD COLUMN last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD CONSTRAINT workspace_invites_role_not_owner CHECK (role <> 'owner'),
    ADD CONSTRAINT workspace_invites_email_lower CHECK (email = lower(email));

CREATE UNIQUE INDEX workspace_invites_pending_unique
    ON workspace_invites (workspace_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_workspace_invites_email ON workspace_invites (email);
