import { test, expect } from '../../fixtures/test-base'

test.describe('Push: registering a browser', () => {
  test('says whether push is set up, and keeps one token per browser', async ({ userRequest, request }) => {
    const config = await userRequest.get('/api/v1/push/config')
    expect(config.status()).toBe(200)
    const settings = (await config.json()).data as { enabled: boolean; vapidKey?: string; firebase?: { projectId: string } }
    expect(typeof settings.enabled).toBe('boolean')
    if (settings.enabled) {
      expect(settings.vapidKey).toBeTruthy()
      expect(settings.firebase?.projectId).toBeTruthy()
    }

    const token = `e2e-token-${Date.now()}`
    expect((await userRequest.post('/api/v1/users/me/push-tokens', { data: { token } })).status()).toBe(204)
    expect((await userRequest.post('/api/v1/users/me/push-tokens', { data: { token } })).status()).toBe(204)
    expect((await userRequest.delete('/api/v1/users/me/push-tokens', { data: { token } })).status()).toBe(204)

    for (const bad of ['', '   ', 'has space', 'x'.repeat(5000)]) {
      expect((await userRequest.post('/api/v1/users/me/push-tokens', { data: { token: bad } })).status(), bad.slice(0, 12)).toBe(400)
    }
    expect((await request.get('/api/v1/push/config')).status()).toBe(401)
    expect((await request.post('/api/v1/users/me/push-tokens', { data: { token } })).status()).toBe(401)
  })
})
