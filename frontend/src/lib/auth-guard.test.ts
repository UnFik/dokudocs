import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  requireAuth,
  requireGuest,
  restoreSession,
  safeRedirect,
} from './auth-guard'
import { queryClient } from './query-client'

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
      expect(safeRedirect(path)).toBe('/')
    expect(safeRedirect('/docs/one?mode=edit')).toBe('/docs/one?mode=edit')
  })
})
