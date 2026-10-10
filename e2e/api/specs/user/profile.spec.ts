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

    // Verify GET reflects the changes
    const getRes = await userRequest.get('/api/v1/users/me/profile')
    expect(getRes.status()).toBe(200)
    const getJson = await getRes.json()
    const refreshed = getJson.data || getJson

    expect(refreshed.fullName).toBe(updatePayload.fullName)
    expect(refreshed.bio).toBe(updatePayload.bio)
  })

  test('should refuse avatarUrl on a profile save: the picture changes only through the avatar endpoints', async ({ userRequest }) => {
    const res = await userRequest.put('/api/v1/users/me/profile', {
      data: { fullName: 'Same Name', avatarUrl: 'https://tracker.example.test/pixel.png' },
    })
    expect(res.status()).toBe(400)
  })

  test('should upload, serve and remove an avatar', async ({ userRequest, request }) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64'
    )
    const putRes = await userRequest.put('/api/v1/users/me/avatar', {
      multipart: { file: { name: 'me.png', mimeType: 'image/png', buffer: png } },
    })
    expect(putRes.status()).toBe(200)
    const profile = ((await putRes.json()).data ?? {}) as { avatarUrl: string }
    expect(profile.avatarUrl).toMatch(/^\/api\/v1\/avatars\/[0-9a-f]{32}$/)

    // An <img> sends no bearer token, so the picture is public by its key.
    const fetched = await request.get(profile.avatarUrl)
    expect(fetched.status()).toBe(200)
    expect(fetched.headers()['content-type']).toBe('image/png')
    expect(fetched.headers()['cache-control']).toContain('immutable')

    const bad = await userRequest.put('/api/v1/users/me/avatar', {
      multipart: { file: { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') } },
    })
    expect(bad.status()).toBe(400)

    const del = await userRequest.delete('/api/v1/users/me/avatar')
    expect(del.status()).toBe(204)
    expect((await request.get(profile.avatarUrl)).status()).toBe(404)
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
