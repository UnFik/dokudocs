-- A fourth provider setting: the small model for short read-only questions and the entry gate.
ALTER TABLE ai_provider_settings DROP CONSTRAINT ai_provider_settings_purpose_check;
ALTER TABLE ai_provider_settings ADD CONSTRAINT ai_provider_settings_purpose_check
    CHECK (purpose IN ('answer', 'embedding', 'embedding_pending', 'agent', 'agent_small'));
