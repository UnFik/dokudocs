Run the live connection tests against a local API with the test superadmin seeded:

```bash
read -rs -p 'Provider API key: ' AI_PROVIDER_TEST_API_KEY
export AI_PROVIDER_TEST_API_KEY
API_URL=http://localhost:8080 bunx playwright test --project=api api/specs/platform/ai-connection.live.spec.ts
unset AI_PROVIDER_TEST_API_KEY
```

The tests call the real provider and consume provider usage. They skip when the key is absent. The defaults are `https://ai.sumopod.com`, `glm-5.3-flash`, and `openai_chat_completions`; override them with `AI_PROVIDER_TEST_BASE_URL`, `AI_PROVIDER_TEST_MODEL`, and `AI_PROVIDER_TEST_PROTOCOL`. Sumopod returned HTTP 404 for the Responses endpoint during testing, so use Chat Completions.

The provided key must succeed and an invalid key must return HTTP 422 with the provider's HTTP 401 error. Both addresses with and without `/v1` are tested. Testing must not save or change any provider setting. Tracing is disabled to avoid recording the key.
