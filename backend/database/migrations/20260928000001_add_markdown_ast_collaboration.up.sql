ALTER TABLE documents
    ADD COLUMN root_node_id UUID,
    ADD COLUMN body_version BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN body_epoch BIGINT NOT NULL DEFAULT 1,
    ADD COLUMN body_schema_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN creation_request_kind TEXT,
    ADD COLUMN creation_request_id UUID,
    ADD COLUMN creation_request_hash BYTEA,
    ADD CONSTRAINT documents_body_version_positive CHECK (body_version > 0),
    ADD CONSTRAINT documents_body_epoch_positive CHECK (body_epoch > 0),
    ADD CONSTRAINT documents_body_schema_version_positive CHECK (body_schema_version > 0),
    ADD CONSTRAINT documents_creation_request_complete CHECK (
        (creation_request_kind IS NULL AND creation_request_id IS NULL AND creation_request_hash IS NULL)
        OR (creation_request_kind IN ('create', 'duplicate') AND creation_request_id IS NOT NULL AND creation_request_hash IS NOT NULL)
    );

CREATE UNIQUE INDEX documents_creation_request_unique
    ON documents (author_id, creation_request_kind, creation_request_id)
    WHERE creation_request_id IS NOT NULL;

CREATE TABLE document_nodes (
    node_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    parent_id UUID,
    sibling_order DOUBLE PRECISION NOT NULL,
    node_type VARCHAR(32) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    attributes JSONB NOT NULL DEFAULT '{}',
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT document_nodes_document_node_unique UNIQUE (document_id, node_id),
    CONSTRAINT document_nodes_parent_same_document_fk
        FOREIGN KEY (document_id, parent_id)
        REFERENCES document_nodes (document_id, node_id)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT document_nodes_order_finite CHECK (
        sibling_order > '-Infinity'::DOUBLE PRECISION
        AND sibling_order < 'Infinity'::DOUBLE PRECISION
    ),
    CONSTRAINT document_nodes_version_positive CHECK (version > 0)
);

CREATE UNIQUE INDEX document_nodes_one_root_per_document
    ON document_nodes (document_id)
    WHERE parent_id IS NULL;

CREATE UNIQUE INDEX document_nodes_sibling_order_unique
    ON document_nodes (document_id, parent_id, sibling_order)
    WHERE parent_id IS NOT NULL;

CREATE INDEX document_nodes_parent_order
    ON document_nodes (document_id, parent_id, sibling_order);

ALTER TABLE documents
    ADD CONSTRAINT documents_root_node_same_document_fk
    FOREIGN KEY (id, root_node_id)
    REFERENCES document_nodes (document_id, node_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE document_collab_states (
    document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    encoded_state BYTEA NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT document_collab_states_schema_version_positive CHECK (schema_version > 0)
);

CREATE TABLE document_command_receipts (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    command_id UUID NOT NULL,
    body_epoch BIGINT NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    request_hash BYTEA NOT NULL,
    body_version BIGINT NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (document_id, command_id),
    CONSTRAINT document_command_receipts_epoch_positive CHECK (body_epoch > 0),
    CONSTRAINT document_command_receipts_version_positive CHECK (body_version > 0)
);

ALTER TABLE comment_threads
    ADD COLUMN anchor_node_id UUID,
    ADD COLUMN anchor_start BYTEA,
    ADD COLUMN anchor_end BYTEA,
    ADD COLUMN anchor_state TEXT NOT NULL DEFAULT 'orphan',
    ADD CONSTRAINT comment_threads_anchor_state_valid CHECK (anchor_state IN ('active', 'orphan')),
    ADD CONSTRAINT comment_threads_anchor_node_fk
        FOREIGN KEY (document_id, anchor_node_id)
        REFERENCES document_nodes (document_id, node_id)
        ON DELETE SET NULL (anchor_node_id)
        DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX comment_threads_anchor_node
    ON comment_threads (document_id, anchor_node_id)
    WHERE anchor_node_id IS NOT NULL;

ALTER TABLE document_revisions
    ADD COLUMN ast_snapshot JSONB,
    ADD COLUMN body_version BIGINT,
    ADD COLUMN body_schema_version INTEGER,
    ADD COLUMN restore_request_id UUID;

CREATE UNIQUE INDEX document_revisions_restore_request_unique
    ON document_revisions (document_id, restore_request_id)
    WHERE restore_request_id IS NOT NULL;
