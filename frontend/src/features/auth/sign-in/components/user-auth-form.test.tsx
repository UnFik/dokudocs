import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { UserAuthForm } from './user-auth-form'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))
function renderForm(redirectTo?: string) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <UserAuthForm redirectTo={redirectTo} />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  navigate.mockClear()
  useAuthStore.getState().auth.reset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

describe('email and Google sign-in', () => {
  it('logs in with an existing short password and sets the session atomically', async () => {
    const session = testSession()
    const fetch = vi.fn().mockResolvedValue(jsonResponse(session))
    vi.stubGlobal('fetch', fetch)
    const screen = await renderForm('/account')
    await screen
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill('user@example.com')
    await screen.getByLabelText('Password', { exact: true }).fill('old')
    await screen.getByRole('button', { name: 'Sign in', exact: true }).click()
    await vi.waitFor(() =>
      expect(useAuthStore.getState().auth.user).toEqual(session.user)
    )
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      email: 'user@example.com',
      password: 'old',
    })
    expect(navigate).toHaveBeenCalledWith({ to: '/account', replace: true })
  })
  it('keeps Google configuration errors inline without navigating', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ title: 'Google login belum dikonfigurasi' }, 503)
        )
    )
    const screen = await renderForm()
    await screen.getByRole('button', { name: 'Continue with Google' }).click()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Google login belum dikonfigurasi')
    expect(navigate).not.toHaveBeenCalled()
    await expect
      .element(screen.getByText('Password recovery is not available yet.'))
      .toBeVisible()
  })
  it('shows credential errors without treating login 401 as session expiry', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ title: 'Invalid credentials' }, 401))
    )
    const screen = await renderForm()
    await screen
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill('user@example.com')
    await screen.getByLabelText('Password', { exact: true }).fill('wrong')
    await screen.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Invalid credentials')
    expect(navigate).not.toHaveBeenCalled()
  })
})
