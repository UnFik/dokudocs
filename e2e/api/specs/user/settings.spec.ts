import { test, expect } from '../../fixtures/test-base'

test.describe('User: Settings endpoints', () => {
  test('should retrieve default user settings with 200 OK', async ({ userRequest, userContext }) => {
    const res = await userRequest.get('/api/v1/users/me/settings')

    expect(res.status()).toBe(200)
    const json = await res.json()
    const settings = json.data || json

    expect(settings.userId).toBe(userContext.user.id)
    expect(settings.theme).toBeDefined()
    expect(settings.fontFamily).toBeDefined()
    expect(settings.direction).toBeDefined()
    expect(settings.language).toBeDefined()
    expect(settings.editorPrefs).toBeDefined()
    expect(settings.notificationPrefs).toBeDefined()
  })

  test('should update settings preferences and persist changes', async ({ userRequest }) => {
    const customPrefs = {
      theme: 'dark',
      fontFamily: 'jetbrains-mono',
      direction: 'ltr',
      language: 'id',
      notificationPrefs: { email: false, in_app: true },
      editorPrefs: {
        view_mode: 'editor-only',
        split_percent: 60,
        is_live_render: false,
        sync_scroll: true,
        show_outline: true,
        preview_mode: 'edit',
      },
    }

    const putRes = await userRequest.put('/api/v1/users/me/settings', {
      data: customPrefs,
    })

    expect(putRes.status()).toBe(200)
    const putJson = await putRes.json()
    const updated = putJson.data || putJson

    expect(updated.theme).toBe('dark')
    expect(updated.fontFamily).toBe('jetbrains-mono')
    expect(updated.language).toBe('id')

    // Parse stringified JSON fields if needed
    const editorPrefs = typeof updated.editorPrefs === 'string' ? JSON.parse(updated.editorPrefs) : updated.editorPrefs
    expect(editorPrefs.view_mode).toBe('editor-only')
    expect(editorPrefs.split_percent).toBe(60)

    // Verify subsequent GET
    const getRes = await userRequest.get('/api/v1/users/me/settings')
    expect(getRes.status()).toBe(200)
    const getJson = await getRes.json()
    const refreshed = getJson.data || getJson

    expect(refreshed.theme).toBe('dark')
    expect(refreshed.language).toBe('id')
  })

  test('should reject unauthenticated settings requests with 401 Unauthorized', async ({ request }) => {
    const getRes = await request.get('/api/v1/users/me/settings')
    expect(getRes.status()).toBe(401)

    const putRes = await request.put('/api/v1/users/me/settings', {
      data: { theme: 'dark' },
    })
    expect(putRes.status()).toBe(401)
  })
})
