-- Architecture documents: a canvas of Hosts, Systems and Connections (ADR 0031).
-- PostgreSQL cannot use a new enum value in the transaction that adds it, so this file does nothing else.
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'architecture';
