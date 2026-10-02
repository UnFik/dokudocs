import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { SignUpForm } from './sign-up-form'

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))
function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SignUpForm />
    </QueryClientProvider>
  )
}
beforeEach(() => useAuthStore.getState().auth.reset())
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

describe('registration constraints', () => {
  it('accepts a 15-character password with spaces unchanged', async () => {
    const session = testSession()
    const fetch = vi.fn().mockResolvedValue(jsonResponse(session))
    vi.stubGlobal('fetch', fetch)
    const screen = await renderForm()
    await screen.getByLabelText('Full Name', { exact: true }).fill('Real User')
    await screen
      .getByLabelText('Email', { exact: true })
      .fill('user@example.com')
    await screen
      .getByLabelText('Password', { exact: true })
      .fill('  long password  ')
    await screen
      .getByLabelText('Confirm Password', { exact: true })
      .fill('  long password  ')
    await screen.getByRole('button', { name: 'Create Account' }).click()
    await vi.waitFor(() =>
      expect(useAuthStore.getState().auth.user).toEqual(session.user)
    )
    expect(JSON.parse(fetch.mock.calls[0][1].body).password).toBe(
      '  long password  '
    )
  })
  it('rejects short passwords and passwords over 72 UTF-8 bytes', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const screen = await renderForm()
    await screen.getByLabelText('Full Name', { exact: true }).fill('Real User')
    await screen
      .getByLabelText('Email', { exact: true })
      .fill('user@example.com')
    await screen.getByLabelText('Password', { exact: true }).fill('short')
    await screen
      .getByLabelText('Confirm Password', { exact: true })
      .fill('short')
    await screen.getByRole('button', { name: 'Create Account' }).click()
    await expect
      .element(
        screen.getByText('Password must be at least 15 characters long.')
      )
      .toBeVisible()
    await screen
      .getByLabelText('Password', { exact: true })
      .fill('😀'.repeat(19))
    await screen
      .getByLabelText('Confirm Password', { exact: true })
      .fill('😀'.repeat(19))
    await screen.getByRole('button', { name: 'Create Account' }).click()
    await expect
      .element(screen.getByText('Password must be at most 72 UTF-8 bytes.'))
      .toBeVisible()
    expect(fetch).not.toHaveBeenCalled()
  })
})
