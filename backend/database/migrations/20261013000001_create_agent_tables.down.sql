DROP TABLE skills;
DROP TABLE mcp_audit;
DROP TABLE mcp_settings;
DROP TABLE mcp_api_keys;
DROP TABLE ai_assisted_suggestions;
DROP TABLE agent_pending_actions;
ALTER TABLE rag_messages DROP COLUMN meta;
DROP INDEX rag_conversations_creator_document;
ALTER TABLE rag_conversations DROP COLUMN document_id;
DROP TABLE ai_model_usage;
DELETE FROM ai_provider_settings WHERE purpose = 'agent';
ALTER TABLE ai_provider_settings DROP CONSTRAINT ai_provider_settings_purpose_check;
ALTER TABLE ai_provider_settings ADD CONSTRAINT ai_provider_settings_purpose_check
    CHECK (purpose IN ('answer', 'embedding', 'embedding_pending'));
DROP TABLE ai_permissions;
