import { test, expect } from '../../fixtures/test-base'

test.describe('User: GET /api/v1/users (Search)', () => {
  test('should search users by query keyword with 200 OK', async ({ userRequest }) => {
    const res = await userRequest.get('/api/v1/users?q=admin')

    expect(res.status()).toBe(200)
    const json = await res.json()
    const users = json.data || json

    expect(Array.isArray(users)).toBe(true)
    expect(users.length).toBeGreaterThan(0)
    const admin = users.find((u: { email: string }) => u.email === 'admin@example.com')
    expect(admin).toBeDefined()
    expect(admin.email).toBe('admin@example.com')
    expect(admin).toHaveProperty('id')
    expect(admin).toHaveProperty('fullName')
  })

  test('should find registered user by exact or unique email', async ({ userRequest, userContext }) => {
    const res = await userRequest.get(`/api/v1/users?q=${encodeURIComponent(userContext.user.email)}`)

    expect(res.status()).toBe(200)
    const json = await res.json()
    const users = json.data || json

    expect(Array.isArray(users)).toBe(true)
    const found = users.find((u: { id: string }) => u.id === userContext.user.id)
    expect(found).toBeDefined()
    expect(found.email).toBe(userContext.user.email)
  })

  test('should respect the limit query parameter', async ({ userRequest }) => {
    const res = await userRequest.get('/api/v1/users?q=&limit=1')

    expect(res.status()).toBe(200)
    const json = await res.json()
    const users = json.data || json

    expect(Array.isArray(users)).toBe(true)
    expect(users.length).toBeLessThanOrEqual(1)
  })

  test('should reject unauthenticated user search with 401 Unauthorized', async ({ request }) => {
    const res = await request.get('/api/v1/users?q=admin')
    expect(res.status()).toBe(401)
  })
})
