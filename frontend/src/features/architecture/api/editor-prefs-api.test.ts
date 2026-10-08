import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { readEditorPrefs, writeEditorPref } from './editor-prefs-api'

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

/** The settings endpoint: a slow write, so two writes would overlap if nothing kept them apart. */
function settingsServer() {
  let editorPrefs = '{}'
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { editorPrefs: unknown }
      await new Promise((r) => setTimeout(r, 30))
      editorPrefs = JSON.stringify(body.editorPrefs)
      return new Response(null, { status: 204 })
    }
    return jsonResponse({
      theme: 'system',
      fontFamily: 'inter',
      direction: 'ltr',
      language: 'en',
      notificationPrefs: '{}',
      editorPrefs,
    })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('writing editor preferences', () => {
  it('keeps every key when two are written one after the other', async () => {
    settingsServer()
    await Promise.all([
      writeEditorPref('architecture_palette_width', 216),
      writeEditorPref('architecture_props_open', false),
      writeEditorPref('architecture_palette_width', 296),
    ])
    expect(await readEditorPrefs()).toEqual({
      architecture_palette_width: 296,
      architecture_props_open: false,
    })
  })

  it('goes on with the next write after one fails', async () => {
    const fetch = settingsServer()
    fetch.mockImplementationOnce(
      async () => new Response('down', { status: 503 })
    )
    await expect(
      writeEditorPref('architecture_palette_width', 300)
    ).rejects.toThrow()
    await writeEditorPref('architecture_props_width', 320)
    expect(await readEditorPrefs()).toEqual({ architecture_props_width: 320 })
  })
})
