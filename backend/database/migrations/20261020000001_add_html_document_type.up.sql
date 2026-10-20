-- HTML documents: a page written through MCP and shown in a sandbox (ADR 0052).
-- PostgreSQL cannot use a new enum value in the transaction that adds it, so this file does nothing else.
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'html';
