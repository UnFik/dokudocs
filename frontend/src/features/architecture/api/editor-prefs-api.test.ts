import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { useAuthStore } from '@/stores/auth-store'
import { readEditorPrefs, writeEditorPref } from './editor-prefs-api'

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

describe('remembering an editor preference', () => {
  it('changes one key and keeps every other setting as it was', async () => {
    const stored = {
      userId: testSession().user.id, theme: 'dark', fontFamily: 'inter', direction: 'ltr', language: 'id',
      notificationPrefs: '{"email":true}', editorPrefs: '{"view_mode":"split"}', updatedAt: '2026-10-08T00:00:00Z',
    }
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(init?.method === 'PUT' ? jsonResponse(stored) : jsonResponse(stored))
    )
    vi.stubGlobal('fetch', fetch)

    expect(await readEditorPrefs()).toEqual({ view_mode: 'split' })
    await writeEditorPref('architecture_palette_open', false)
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(JSON.parse(String(put[1]?.body))).toEqual({
      theme: 'dark', fontFamily: 'inter', direction: 'ltr', language: 'id',
      notificationPrefs: { email: true },
      editorPrefs: { view_mode: 'split', architecture_palette_open: false },
    })
  })
})
