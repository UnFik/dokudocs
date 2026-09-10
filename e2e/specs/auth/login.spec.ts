import { test, expect } from '../../fixtures/test-base'

test.describe('Auth: POST /api/v1/auth/login', () => {
  test('should authenticate successfully with valid credentials', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: {
        email: 'admin@example.com',
        password: 'password123',
      },
    })

    expect(res.status()).toBe(200)
    const json = await res.json()
    const payload = json.data || json

    expect(payload.accessToken).toBeDefined()
    expect(payload.accessToken.length).toBeGreaterThan(20)
    expect(payload.user).toBeDefined()
    expect(payload.user.email).toBe('admin@example.com')
    expect(payload.user.accountNo).toBe('ACC001')
    expect(payload.user.role).toContain('admin')
  })

  test('should reject invalid password with 401 Unauthorized', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: {
        email: 'admin@example.com',
        password: 'wrongpassword',
      },
    })

    expect(res.status()).toBe(401)
    const json = await res.json()
    expect(json.title || json.message).toMatch(/invalid email or password/i)
  })

  test('should reject missing email or password with 400 Bad Request', async ({ request }) => {
    const res = await request.post('/api/v1/auth/login', {
      data: {},
    })

    expect(res.status()).toBe(400)
  })
})
