import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { AccountPage } from '.'

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})
it('shows the real profile and does not offer unintegrated edits', async () => {
  const { user } = testSession()
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          id: user.id,
          email: user.email,
          fullName: 'Current Person',
          bio: 'My profile',
          phoneNumber: '',
          avatarUrl: '',
        })
      )
  )
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountPage />
    </QueryClientProvider>
  )
  await expect
    .element(screen.getByLabelText('Full Name'))
    .toHaveValue('Current Person')
  await expect
    .element(screen.getByLabelText('Email Address'))
    .toHaveValue(user.email)
  await expect
    .element(
      screen.getByRole('button', { name: 'Save Changes (not available)' })
    )
    .toBeDisabled()
})
it('falls back to signed-in email on a profile server failure without logging out', async () => {
  const session = testSession()
  useAuthStore.getState().auth.setSession(session)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ title: 'Unavailable' }, 503))
  )
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AccountPage />
    </QueryClientProvider>
  )
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Profile unavailable')
  await expect
    .element(screen.getByLabelText('Full Name'))
    .toHaveValue(session.user.email)
  expect(useAuthStore.getState().auth.user).toEqual(session.user)
})
