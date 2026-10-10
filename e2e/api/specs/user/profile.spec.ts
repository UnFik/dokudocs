import zlib from 'node:zlib'
import { test, expect } from '../../fixtures/test-base'

// A real PNG (signature, header, one compressed block, end), so a browser can decode it too.
function solidPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x66)])
  const pixels = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// The fixtures send every request as JSON, so the form is built by hand with its own header.
function pictureForm(buffer: Buffer) {
  const boundary = '----dokudocs-e2e'
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="me.png"\r\nContent-Type: image/png\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return { data: body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } }
}

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
    const png = solidPng(64, 64)
    const putRes = await userRequest.put('/api/v1/users/me/avatar', pictureForm(png))
    expect(putRes.status()).toBe(200)
    const profile = ((await putRes.json()).data ?? {}) as { avatarUrl: string }
    expect(profile.avatarUrl).toMatch(/^\/api\/v1\/avatars\/[0-9a-f]{32}$/)

    // An <img> sends no bearer token, so the picture is public by its key.
    const fetched = await request.get(profile.avatarUrl)
    expect(fetched.status()).toBe(200)
    expect(fetched.headers()['content-type']).toBe('image/png')
    expect(fetched.headers()['cache-control']).toContain('immutable')

    const bad = await userRequest.put('/api/v1/users/me/avatar', pictureForm(Buffer.from('not a picture')))
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
