-- The catalog an Architecture document draws with (docs/plans/architecture-catalog.md).
-- It is the same for everyone; only a migration changes it, and a slug is never removed.
CREATE TYPE catalog_category AS ENUM ('host', 'system', 'protocol');

CREATE TABLE catalog_entries (
    slug        TEXT PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    category    catalog_category NOT NULL,
    subkind     TEXT NOT NULL,
    name        TEXT NOT NULL,
    family      TEXT CHECK ((category = 'protocol') = (family IS NOT NULL)),
    sort_order  INT NOT NULL DEFAULT 0,
    deprecated  BOOLEAN NOT NULL DEFAULT FALSE
);

-- A request for an entry the catalog does not have. Names that share a key
-- (lowercase letters and digits) are one request; each person adds one vote.
CREATE TABLE catalog_requests (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    name_key       TEXT NOT NULL UNIQUE,
    category       catalog_category NOT NULL,
    website        TEXT,
    note           TEXT CHECK (length(note) <= 1000),
    status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'added', 'declined')),
    resolved_slug  TEXT REFERENCES catalog_entries(slug),
    decline_reason TEXT,
    created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE catalog_request_votes (
    request_id   UUID NOT NULL REFERENCES catalog_requests(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (request_id, user_id)
);

CREATE INDEX idx_catalog_request_votes_user ON catalog_request_votes (user_id);
