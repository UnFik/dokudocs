import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '@/stores/auth-store'
import { apiFetch, ApiError, onEmailNotVerified } from './api-client'

beforeEach(() => useAuthStore.getState().auth.reset())
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

describe('same-origin API session boundary', () => {
  it('unwraps responses, adds Bearer only to its own API, and rejects external URLs', async () => {
    useAuthStore.getState().auth.setSession(testSession())
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ id: 'one' }))
    vi.stubGlobal('fetch', fetch)
    expect(await apiFetch('/api/v1/test')).toEqual({ id: 'one' })
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe(
      `Bearer ${testSession().accessToken}`
    )
    await expect(apiFetch('https://external.test/api/test')).rejects.toThrow(
      'same-origin'
    )
    expect(fetch).toHaveBeenCalledOnce()
  })
  it('ends the session on authenticated 401, but not a login rejection', async () => {
    const session = testSession()
    useAuthStore.getState().auth.setSession(session)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse({ title: 'Unauthorized' }, 401))
        )
    )
    await expect(
      apiFetch('/api/v1/auth/login', { authenticated: false })
    ).rejects.toThrow(ApiError)
    expect(useAuthStore.getState().auth.user).toEqual(session.user)
    await expect(apiFetch('/api/v1/users/me/profile')).rejects.toThrow(ApiError)
    expect(useAuthStore.getState().auth.user).toBeNull()
  })
  it('does not let a stale 401 clear a newer session', async () => {
    useAuthStore.getState().auth.setSession(testSession())
    let finish: (response: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          })
      )
    )
    const request = apiFetch('/api/v1/test')
    const next = testSession('6c09cac7-e7e4-41ea-aad7-08a895af9c29')
    useAuthStore.getState().auth.setSession(next)
    finish(jsonResponse({ title: 'Unauthorized' }, 401))
    await expect(request).rejects.toThrow('Session changed')
    expect(useAuthStore.getState().auth.user?.id).toBe(next.user.id)
  })
})

describe('email verification gate', () => {
  it('tells the app once when the server says the email is not verified', async () => {
    useAuthStore.getState().auth.setSession(testSession())
    const handler = vi.fn()
    const stop = onEmailNotVerified(handler)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            {
              title: 'Verify your email to continue',
              code: 'email_not_verified',
            },
            403
          )
        )
    )
    await expect(apiFetch('/api/v1/projects')).rejects.toMatchObject({
      status: 403,
    })
    expect(handler).toHaveBeenCalledOnce()
    stop()
  })
  it('leaves other 403 answers alone and keeps the session', async () => {
    const session = testSession()
    useAuthStore.getState().auth.setSession(session)
    const handler = vi.fn()
    const stop = onEmailNotVerified(handler)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ title: 'Forbidden' }, 403))
    )
    await expect(apiFetch('/api/v1/projects')).rejects.toThrow(ApiError)
    expect(handler).not.toHaveBeenCalled()
    expect(useAuthStore.getState().auth.user).toEqual(session.user)
    stop()
  })
})
