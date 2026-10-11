import { test, expect } from '../../fixtures/test-base'

const apiKey = process.env.AI_PROVIDER_TEST_API_KEY || ''
const baseURL = process.env.AI_PROVIDER_TEST_BASE_URL || 'https://ai.sumopod.com'
const model = process.env.AI_PROVIDER_TEST_MODEL || 'glm-5.3-flash'
const protocol = process.env.AI_PROVIDER_TEST_PROTOCOL || 'openai_chat_completions'
const rootURL = baseURL.replace(/\/v1\/?$/, '').replace(/\/$/, '')
test.use({ trace: 'off' })

test.describe('AI provider connection @live', () => {
  test.skip(!apiKey, 'Set AI_PROVIDER_TEST_API_KEY to call the real provider')
  test.setTimeout(60_000)

  for (const address of [rootURL, `${rootURL}/v1`]) {
    for (const credential of [
      { name: 'provided key', key: apiKey, status: 200 },
      { name: 'invalid key', key: 'invalid-e2e-key', status: 422 },
    ]) {
      test(`Answer connection at ${address} using ${credential.name}`, async ({ adminRequest }) => {
        const before = await adminRequest.get('/api/v1/platform/ai')
        expect(before.status()).toBe(200)
        const settings = (await before.json()).data

        const response = await adminRequest.post('/api/v1/platform/ai/answer/test', {
          data: { baseURL: address, model, protocol, apiKey: credential.key },
          timeout: 50_000,
        })
        const result = (await response.text()).replaceAll(apiKey, '<redacted>')
        expect(response.status(), result).toBe(credential.status)
        const body = JSON.parse(result)
        if (credential.status === 200) {
          expect(body.data).toEqual({ ok: true })
        } else {
          expect(body.title).toContain('HTTP 401')
        }

        const after = await adminRequest.get('/api/v1/platform/ai')
        expect(after.status()).toBe(200)
        expect((await after.json()).data).toEqual(settings)
      })
    }
  }
})
