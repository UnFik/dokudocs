import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { consumeGoogleCallback } from './google-callback'

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('removes the callback code before a single exchange and uses only the server return destination', async () => {
  const session = testSession()
  const original = window.location.href
  history.replaceState(
    history.state,
    '',
    '/auth/callback?code=one-use&redirect=https://evil.test'
  )
  const fetch = vi.fn(() => {
    expect(window.location.search).toBe('')
    return Promise.resolve(jsonResponse({ ...session, redirect: '/account' }))
  })
  vi.stubGlobal('fetch', fetch)
  try {
    expect(
      await Promise.all([consumeGoogleCallback(), consumeGoogleCallback()])
    ).toEqual(['/account', '/account'])
    expect(fetch).toHaveBeenCalledOnce()
    expect(useAuthStore.getState().auth.user).toEqual(session.user)
  } finally {
    history.replaceState(history.state, '', original)
  }
})
