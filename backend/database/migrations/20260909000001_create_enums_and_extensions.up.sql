CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'guest');
CREATE TYPE project_visibility AS ENUM ('workspace', 'private');
CREATE TYPE project_member_role AS ENUM ('manager', 'editor', 'viewer');
CREATE TYPE document_type AS ENUM ('markdown', 'dbdiagram', 'mermaid');
CREATE TYPE document_visibility AS ENUM ('inherit', 'workspace', 'private', 'public_link');
CREATE TYPE document_access_level AS ENUM ('owner', 'edit', 'comment', 'view');
