-- One row per attempt to sign in (or link an account) with an outside provider.
-- status: started -> claimed (the callback arrived) -> completed (an exchange code
-- was issued) -> consumed. Secrets the browser holds are stored as hashes; the
-- verifier is kept because the callback has to send it to the provider.
CREATE TABLE oauth_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,
    purpose VARCHAR(10) NOT NULL,
    state_hash CHAR(64) NOT NULL UNIQUE,
    binding_hash CHAR(64) NOT NULL,
    nonce VARCHAR(128) NOT NULL,
    code_verifier VARCHAR(128) NOT NULL,
    redirect_path TEXT NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(10) NOT NULL DEFAULT 'started',
    exchange_code_hash CHAR(64) UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT oauth_transactions_purpose_check CHECK (purpose IN ('sign_in', 'link')),
    CONSTRAINT oauth_transactions_status_check CHECK (status IN ('started', 'claimed', 'completed', 'consumed')),
    CONSTRAINT oauth_transactions_link_has_user CHECK (purpose <> 'link' OR user_id IS NOT NULL),
    CONSTRAINT oauth_transactions_completed_has_code CHECK (status NOT IN ('completed') OR (exchange_code_hash IS NOT NULL AND user_id IS NOT NULL))
);

CREATE INDEX idx_oauth_transactions_expires ON oauth_transactions (expires_at);
