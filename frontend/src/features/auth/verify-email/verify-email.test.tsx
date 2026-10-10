import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { VerifyEmailPage } from '.'
import {
  consumeVerificationLink,
  forgetVerificationLink,
  VerificationLinkError,
} from './verification-link'

afterEach(() => {
  forgetVerificationLink()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function withQueries(node: React.ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  )
}

it('removes the token from the address before sending it, signs the User in and verifies once', async () => {
  const session = testSession()
  const original = window.location.href
  history.replaceState(history.state, '', '/verify-email?token=abc_-123')
  const fetch = vi.fn((_url: string, init: RequestInit) => {
    expect(window.location.search).toBe('')
    expect(JSON.parse(String(init.body))).toEqual({ token: 'abc_-123' })
    return Promise.resolve(
      jsonResponse({
        ...session,
        user: { ...session.user, emailVerified: true },
      })
    )
  })
  vi.stubGlobal('fetch', fetch)
  try {
    await Promise.all([consumeVerificationLink(), consumeVerificationLink()])
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][0]).toContain('/api/v1/auth/email/verify')
    expect(useAuthStore.getState().auth.user?.emailVerified).toBe(true)
  } finally {
    history.replaceState(history.state, '', original)
  }
})

it('fails with a typed error for a link the server refuses', async () => {
  const original = window.location.href
  history.replaceState(history.state, '', '/verify-email?token=old')
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { title: 'verification link is invalid or has expired' },
          400
        )
      )
  )
  try {
    await expect(consumeVerificationLink()).rejects.toBeInstanceOf(
      VerificationLinkError
    )
    expect(useAuthStore.getState().auth.status).toBe('guest')
  } finally {
    history.replaceState(history.state, '', original)
  }
})

it('does nothing when the address has no token', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  expect(await consumeVerificationLink()).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it('shows where the link went and sends it again on request', async () => {
  const session = testSession()
  useAuthStore.getState().auth.setSession(session)
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const screen = await render(withQueries(<VerifyEmailPage />))

  await expect.element(screen.getByText(session.user.email)).toBeVisible()
  await screen.getByRole('button', { name: 'Send the link again' }).click()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('A new link is on its way')
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0][0]).toContain('/api/v1/auth/email/resend')
  expect(fetch.mock.calls[0][1].method).toBe('POST')
})

it.each([
  [429, /Wait a minute/],
  [503, /not set up/],
  [502, /Could not send/],
])('explains a %s answer when sending again', async (status, message) => {
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ title: 'x' }, status))
  )
  const screen = await render(withQueries(<VerifyEmailPage />))
  await screen.getByRole('button', { name: 'Send the link again' }).click()
  await expect.element(screen.getByRole('alert')).toHaveTextContent(message)
})

it('signs out from the page', async () => {
  useAuthStore.getState().auth.setSession(testSession())
  const screen = await render(withQueries(<VerifyEmailPage />))
  await screen.getByRole('button', { name: 'Sign out' }).click()
  expect(useAuthStore.getState().auth.status).toBe('guest')
})
