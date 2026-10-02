CREATE TABLE document_suggestions (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    suggestion_id UUID NOT NULL,
    proposer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    decider_id UUID REFERENCES users(id) ON DELETE SET NULL,
    base_body_version BIGINT NOT NULL,
    base_body_epoch BIGINT NOT NULL,
    operation_schema_version INTEGER NOT NULL DEFAULT 1,
    provenance TEXT NOT NULL,
    operations JSONB NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    PRIMARY KEY (document_id, suggestion_id),
    CONSTRAINT document_suggestions_body_version_positive CHECK (base_body_version > 0),
    CONSTRAINT document_suggestions_body_epoch_positive CHECK (base_body_epoch > 0),
    CONSTRAINT document_suggestions_operation_schema_positive CHECK (operation_schema_version > 0),
    CONSTRAINT document_suggestions_status_valid CHECK (status IN ('pending', 'accepted', 'rejected', 'conflicted')),
    CONSTRAINT document_suggestions_provenance_valid CHECK (provenance IN ('human', 'AI')),
    CONSTRAINT document_suggestions_decision_complete CHECK (
        (status = 'pending' AND decider_id IS NULL AND decided_at IS NULL)
        OR (status <> 'pending' AND decider_id IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX document_suggestions_visible
    ON document_suggestions (document_id, status, created_at);

