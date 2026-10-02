import { test, expect } from '../../fixtures/test-base'

test.describe('User: Profile endpoints', () => {
  test('should get current user profile with 200 OK', async ({ userRequest, userContext }) => {
    const res = await userRequest.get('/api/v1/users/me/profile')

    expect(res.status()).toBe(200)
    const json = await res.json()
    const payload = json.data || json

    expect(payload.id).toBe(userContext.user.id)
    expect(payload.email).toBe(userContext.user.email)
    expect(payload.accountNo).toBe(userContext.user.accountNo)
    expect(payload).toHaveProperty('bio')
    expect(payload).toHaveProperty('phoneNumber')
  })

  test('should update profile fields and persist changes', async ({ userRequest, userContext }) => {
    const updatePayload = {
      fullName: 'Updated Name ' + userContext.user.accountNo,
      phoneNumber: '+1234567890',
      bio: 'Staff Technical Lead & Architect',
      avatarUrl: 'https://example.com/avatar-updated.png',
    }

    // Update profile
    const putRes = await userRequest.put('/api/v1/users/me/profile', {
      data: updatePayload,
    })

    expect(putRes.status()).toBe(200)
    const putJson = await putRes.json()
    const updated = putJson.data || putJson

    expect(updated.fullName).toBe(updatePayload.fullName)
    expect(updated.phoneNumber).toBe(updatePayload.phoneNumber)
    expect(updated.bio).toBe(updatePayload.bio)
    expect(updated.avatarUrl).toBe(updatePayload.avatarUrl)

    // Verify GET reflects the changes
    const getRes = await userRequest.get('/api/v1/users/me/profile')
    expect(getRes.status()).toBe(200)
    const getJson = await getRes.json()
    const refreshed = getJson.data || getJson

    expect(refreshed.fullName).toBe(updatePayload.fullName)
    expect(refreshed.bio).toBe(updatePayload.bio)
  })

  test('should reject unauthenticated profile requests with 401 Unauthorized', async ({ request }) => {
    const getRes = await request.get('/api/v1/users/me/profile')
    expect(getRes.status()).toBe(401)

    const putRes = await request.put('/api/v1/users/me/profile', {
      data: { fullName: 'Hacker' },
    })
    expect(putRes.status()).toBe(401)
  })
})
