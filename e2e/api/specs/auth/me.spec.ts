import { test, expect } from '../../fixtures/test-base'

test.describe('Auth: GET /api/v1/auth/me', () => {
  test('should return authenticated user claims for valid token', async ({ userRequest, userContext }) => {
    const res = await userRequest.get('/api/v1/auth/me')

    expect(res.status()).toBe(200)
    const json = await res.json()
    const payload = json.data || json

    expect(payload.id).toBe(userContext.user.id)
    expect(payload.email).toBe(userContext.user.email)
    expect(payload.accountNo).toBe(userContext.user.accountNo)
    expect(payload.role).toContain('member')
  })

  test('should return admin claims for admin token', async ({ adminRequest }) => {
    const res = await adminRequest.get('/api/v1/auth/me')

    expect(res.status()).toBe(200)
    const json = await res.json()
    const payload = json.data || json

    expect(payload.email).toBe('admin@example.com')
    expect(payload.accountNo).toBe('ACC001')
    expect(payload.role).toContain('admin')
  })

  test('should reject request with no Authorization header with 401', async ({ request }) => {
    const res = await request.get('/api/v1/auth/me')
    expect(res.status()).toBe(401)
  })

  test('should reject request with invalid Bearer token with 401', async ({ request }) => {
    const res = await request.get('/api/v1/auth/me', {
      headers: {
        Authorization: 'Bearer invalid.token.value',
      },
    })
    expect(res.status()).toBe(401)
  })
})
