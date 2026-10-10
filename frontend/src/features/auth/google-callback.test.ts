import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import {
  consumeGoogleCallback,
  forgetGoogleCallback,
  GoogleSignInError,
  googleCallbackMessage,
} from './google-callback'

afterEach(() => {
  forgetGoogleCallback()
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

it.each(['expired', 'denied', 'failed'])(
  'turns the %s error from the server into a typed failure without calling the API',
  async (code) => {
    const original = window.location.href
    history.replaceState(history.state, '', `/auth/callback?error=${code}`)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      forgetGoogleCallback()
      const failure = await consumeGoogleCallback().catch((error) => error)
      expect(failure).toBeInstanceOf(GoogleSignInError)
      expect(failure.code).toBe(code)
      expect(fetch).not.toHaveBeenCalled()
      expect(window.location.search).toBe('')
    } finally {
      history.replaceState(history.state, '', original)
    }
  }
)

it('says what happened for each error and falls back to a generic message', () => {
  expect(googleCallbackMessage('expired')).toMatch(
    /expired or was already used/
  )
  expect(googleCallbackMessage('denied')).toMatch(/cancelled/)
  expect(googleCallbackMessage('failed')).toMatch(/could not be completed/)
  expect(googleCallbackMessage('something-new')).toMatch(
    /could not be completed/
  )
  expect(googleCallbackMessage(undefined)).toMatch(/could not be completed/)
})
