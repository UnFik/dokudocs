-- An Architecture version: a named revision of the canvas plus a pin to a named
-- revision of every linked document the tagger could read (ADR 0032).
CREATE TABLE architecture_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    architecture_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision_id     UUID NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
    label           TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
    description     TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (architecture_id, label)
);

-- revision_id is null when the tagger could not read the document: not pinned.
CREATE TABLE architecture_version_pins (
    version_id  UUID NOT NULL REFERENCES architecture_versions(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    revision_id UUID REFERENCES document_revisions(id) ON DELETE SET NULL,
    PRIMARY KEY (version_id, document_id)
);
