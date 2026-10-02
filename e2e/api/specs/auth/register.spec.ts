import { test, expect } from '../../fixtures/test-base'
import { generateUser } from '../../helpers/factory'

test.describe('Auth: POST /api/v1/auth/register', () => {
  test('should register a new user successfully with 201 Created', async ({ request }) => {
    const newUser = generateUser()
    const res = await request.post('/api/v1/auth/register', {
      data: newUser,
    })

    expect(res.status()).toBe(201)
    const json = await res.json()
    const payload = json.data || json

    expect(payload.accessToken).toBeDefined()
    expect(payload.accessToken.length).toBeGreaterThan(20)
    expect(payload.user).toBeDefined()
    expect(payload.user.email).toBe(newUser.email.toLowerCase())
    expect(payload.user.accountNo).toBeDefined()
    expect(payload.user.role).toContain('member')
  })

  test('should reject registration with already registered email with 409 Conflict', async ({ request }) => {
    const newUser = generateUser()
    // First registration
    const res1 = await request.post('/api/v1/auth/register', {
      data: newUser,
    })
    expect(res1.status()).toBe(201)

    // Second registration with the exact same email
    const res2 = await request.post('/api/v1/auth/register', {
      data: newUser,
    })
    expect(res2.status()).toBe(409)
    const json = await res2.json()
    expect(json.title || json.message).toMatch(/already registered|already exists/i)
  })

  test('should reject registration when required fields are missing with 400 Bad Request', async ({ request }) => {
    const res = await request.post('/api/v1/auth/register', {
      data: {
        email: 'invalid-missing-pwd@example.com',
      },
    })

    expect(res.status()).toBe(400)
  })

  test('should reject invalid JSON body with 400 Bad Request', async ({ request }) => {
    const res = await request.post('/api/v1/auth/register', {
      headers: { 'Content-Type': 'application/json' },
      data: 'invalid json',
    })

    expect(res.status()).toBe(400)
  })
})
