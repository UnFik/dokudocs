import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import {
  requireAuth,
  requireDocumentAuth,
  requireGuest,
  restoreSession,
  safeRedirect,
} from './auth-guard'
import { queryClient } from './query-client'
import { switchLocalUser } from './user-storage'

beforeEach(() => {
  useAuthStore.getState().auth.reset()
  queryClient.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function persistedSession() {
  const session = testSession()
  document.cookie = `thisisjustarandomstring=${session.accessToken}; Path=/`
  return session
}
describe('session route guards', () => {
  it('redirects guests, and does not trap invalid tokens on the sign-in page', async () => {
    await expect(
      requireAuth({ location: { href: '/docs/one' } })
    ).rejects.toBeDefined()
    document.cookie = 'thisisjustarandomstring=broken; Path=/'
    await expect(requireGuest()).resolves.toBeUndefined()
  })
  it('blocks until /me restores CurrentUser and shares the in-flight request', async () => {
    const session = persistedSession()
    const fetch = vi.fn().mockResolvedValue(jsonResponse(session.user))
    vi.stubGlobal('fetch', fetch)
    await Promise.all([
      requireAuth({ location: { href: '/' } }),
      requireAuth({ location: { href: '/account' } }),
    ])
    expect(fetch).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().auth.user?.id).toBe(session.user.id)
  })
  it('keeps credentials after server failure and permits an explicit retry', async () => {
    const session = persistedSession()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ title: 'Unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse(session.user))
    vi.stubGlobal('fetch', fetch)
    await expect(restoreSession()).rejects.toThrow('Unavailable')
    expect(useAuthStore.getState().auth.accessToken).toBe(session.accessToken)
    expect(useAuthStore.getState().auth.user).toBeNull()
    await expect(restoreSession()).resolves.toEqual(session.user)
  })
  it('rejects unsafe and auth-loop return destinations', () => {
    for (const path of [
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      '/%2f%2fevil.test',
      '/sign-in',
      '/auth/callback',
      '/unknown',
    ])
      expect(safeRedirect(path)).toBe('/dashboard')
    expect(safeRedirect('/docs/one?mode=edit')).toBe('/docs/one?mode=edit')
  })
})

describe('opening a document with no connection', () => {
  const workspaceId = '33333333-3333-4333-8333-333333333333'
  const record = '55555555-5555-4555-8555-555555555555'
  const keepCopy = (name: string) =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  const cache = (id: string, type: 'dbdiagram' | 'mermaid') =>
    useDokudocsStore.getState().upsertDocument({
      id,
      title: 'Schema',
      type,
      content: '',
      workspaceId,
      replacementId: record,
      orgId: workspaceId,
      author: { id: 'a', name: 'A', email: 'a@example.com', avatar: '' },
      isStarred: false,
      isShared: false,
      createdAt: '2026-10-09T00:00:00Z',
      updatedAt: '2026-10-09T00:00:00Z',
    })

  afterEach(() => switchLocalUser(null))

  it('opens a DBML or Mermaid document this device holds a copy of, on its record', async () => {
    // The cached documents belong to the person signed in on this device.
    switchLocalUser(persistedSession().user.id)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const id = '44444444-4444-4444-8444-444444444441'
    cache(id, 'mermaid')
    await keepCopy(`dokudocs:${workspaceId}.${id}.${record}`)
    await expect(
      requireDocumentAuth({
        params: { docId: id },
        location: { href: `/docs/${id}` },
      })
    ).resolves.toBeUndefined()
    expect(useAuthStore.getState().auth.status).toBe('offline')
  })

  it('does not open one whose copy is of another record', async () => {
    switchLocalUser(persistedSession().user.id)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const id = '44444444-4444-4444-8444-444444444442'
    cache(id, 'dbdiagram')
    await keepCopy(`dokudocs:${workspaceId}.${id}`)
    await expect(
      requireDocumentAuth({
        params: { docId: id },
        location: { href: `/docs/${id}` },
      })
    ).rejects.toBeDefined()
  })
})
