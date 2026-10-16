DELETE FROM ai_provider_settings WHERE purpose = 'agent_small';
ALTER TABLE ai_provider_settings DROP CONSTRAINT ai_provider_settings_purpose_check;
ALTER TABLE ai_provider_settings ADD CONSTRAINT ai_provider_settings_purpose_check
    CHECK (purpose IN ('answer', 'embedding', 'embedding_pending', 'agent'));
