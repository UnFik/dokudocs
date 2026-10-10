import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { SetPasswordPage } from '.'
import { forgetPasswordLinkToken } from './password-link'

const PATH = '/settings/account/set-password'
const strong = 'a long enough password'

function fakeApi(
  state: { hasPassword: boolean },
  answers: Record<string, () => Response> = {}
) {
  return vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`
    if (answers[key]) return Promise.resolve(answers[key]())
    if (key === 'GET /api/v1/auth/identities')
      return Promise.resolve(
        jsonResponse({ hasPassword: state.hasPassword, identities: [] })
      )
    return Promise.resolve(new Response(null, { status: 204 }))
  })
}
const calls = (fetch: ReturnType<typeof vi.fn>, key: string) =>
  fetch.mock.calls.filter(
    ([url, init]) => `${init?.method ?? 'GET'} ${new URL(url).pathname}` === key
  )

async function mount(onLeave = vi.fn()) {
  const screen = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SetPasswordPage onLeave={onLeave} />
    </QueryClientProvider>
  )
  return { screen, onLeave }
}

beforeEach(() => {
  forgetPasswordLinkToken()
  useAuthStore.getState().auth.setSession(testSession())
  window.history.replaceState(null, '', `${PATH}?token=abc`)
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
  window.history.replaceState(null, '', '/')
})

it('takes the token out of the address and sets a first password', async () => {
  const fetch = fakeApi({ hasPassword: false })
  vi.stubGlobal('fetch', fetch)
  const { screen, onLeave } = await mount()

  await expect
    .element(screen.getByRole('heading', { name: 'Set password' }))
    .toBeVisible()
  expect(window.location.search).toBe('')
  expect(
    JSON.parse(calls(fetch, 'POST /api/v1/auth/password/check')[0][1].body)
  ).toEqual({
    token: 'abc',
  })

  await screen.getByLabelText('New password', { exact: true }).fill('too short')
  await screen.getByLabelText('Confirm password').fill('too short')
  await screen.getByRole('button', { name: 'Set password' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('at least 15')
  expect(calls(fetch, 'POST /api/v1/auth/password')).toHaveLength(0)

  await screen.getByLabelText('New password', { exact: true }).fill(strong)
  await screen.getByLabelText('Confirm password').fill(strong + 'x')
  await screen.getByRole('button', { name: 'Set password' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Passwords do not match')
  expect(calls(fetch, 'POST /api/v1/auth/password')).toHaveLength(0)

  await screen.getByLabelText('Confirm password').fill(strong)
  await screen.getByRole('button', { name: 'Set password' }).click()
  await vi.waitFor(() => expect(onLeave).toHaveBeenCalledWith('set'))
  expect(
    JSON.parse(calls(fetch, 'POST /api/v1/auth/password')[0][1].body)
  ).toEqual({
    token: 'abc',
    password: strong,
  })
})

it('changes the password of a User who already has one', async () => {
  vi.stubGlobal('fetch', fakeApi({ hasPassword: true }))
  const { screen, onLeave } = await mount()
  await expect
    .element(screen.getByRole('heading', { name: 'Change password' }))
    .toBeVisible()
  await screen.getByLabelText('New password', { exact: true }).fill(strong)
  await screen.getByLabelText('Confirm password').fill(strong)
  await screen.getByRole('button', { name: 'Change password' }).click()
  await vi.waitFor(() => expect(onLeave).toHaveBeenCalledWith('changed'))
})

it('shows and hides what was typed', async () => {
  vi.stubGlobal('fetch', fakeApi({ hasPassword: false }))
  const { screen } = await mount()
  const field = screen.getByLabelText('New password', { exact: true })
  await expect.element(field).toHaveAttribute('type', 'password')
  await screen.getByRole('button', { name: 'Show password' }).click()
  await expect.element(field).toHaveAttribute('type', 'text')
  await expect
    .element(screen.getByLabelText('Confirm password'))
    .toHaveAttribute('type', 'text')
  await screen.getByRole('button', { name: 'Hide password' }).click()
  await expect.element(field).toHaveAttribute('type', 'password')
})

it('tells the password manager which account the password belongs to', async () => {
  vi.stubGlobal('fetch', fakeApi({ hasPassword: false }))
  const { screen } = await mount()
  await expect
    .element(screen.getByLabelText('New password', { exact: true }))
    .toHaveAttribute('autocomplete', 'new-password')
  const username = document.querySelector('input[autocomplete="username"]')
  expect(username).toHaveProperty('value', 'user@example.com')
})

it('refuses a link that is invalid or has expired, and offers the way back', async () => {
  vi.stubGlobal(
    'fetch',
    fakeApi(
      { hasPassword: false },
      {
        'POST /api/v1/auth/password/check': () =>
          jsonResponse({ title: 'bad' }, 400),
      }
    )
  )
  const { screen, onLeave } = await mount()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('invalid or has expired')
  expect(
    screen.getByLabelText('New password', { exact: true }).elements()
  ).toHaveLength(0)
  await screen.getByRole('button', { name: 'Back to account' }).click()
  expect(onLeave).toHaveBeenCalledWith()
})

it('asks for the link from the email when the address has no token', async () => {
  window.history.replaceState(null, '', PATH)
  vi.stubGlobal('fetch', fakeApi({ hasPassword: false }))
  const { screen } = await mount()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Open the link from your email')
  expect(
    screen.getByLabelText('New password', { exact: true }).elements()
  ).toHaveLength(0)
})

it('offers a retry when the link cannot be checked', async () => {
  const fetch = fakeApi(
    { hasPassword: false },
    {
      'POST /api/v1/auth/password/check': () =>
        jsonResponse({ title: 'down' }, 503),
    }
  )
  vi.stubGlobal('fetch', fetch)
  const { screen } = await mount()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Could not check the link')
  await screen.getByRole('button', { name: 'Try again' }).click()
  await vi.waitFor(() =>
    expect(calls(fetch, 'POST /api/v1/auth/password/check')).toHaveLength(2)
  )
})

it('falls back to the invalid-link message when the link is used up before submitting', async () => {
  vi.stubGlobal(
    'fetch',
    fakeApi(
      { hasPassword: false },
      {
        'POST /api/v1/auth/password': () =>
          jsonResponse(
            { title: 'password link is invalid or has expired' },
            400
          ),
      }
    )
  )
  const { screen, onLeave } = await mount()
  await screen.getByLabelText('New password', { exact: true }).fill(strong)
  await screen.getByLabelText('Confirm password').fill(strong)
  await screen.getByRole('button', { name: 'Set password' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('invalid or has expired')
  expect(onLeave).not.toHaveBeenCalled()
})
