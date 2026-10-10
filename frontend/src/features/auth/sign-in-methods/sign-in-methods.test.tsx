import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { SignInMethods } from '.'

type State = {
  hasPassword: boolean
  identities: { provider: string; email: string; linkedAt: string }[]
}
const linked = {
  provider: 'google',
  email: 'me@gmail.test',
  linkedAt: '2026-10-10T00:00:00Z',
}

// A small stand-in for the API: it answers from `state` and records the calls.
function fakeApi(state: State, answers: Record<string, () => Response> = {}) {
  return vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`
    if (answers[key]) return Promise.resolve(answers[key]())
    if (key === 'GET /api/v1/auth/identities')
      return Promise.resolve(jsonResponse(state))
    return Promise.resolve(new Response(null, { status: 204 }))
  })
}
const calls = (fetch: ReturnType<typeof vi.fn>, key: string) =>
  fetch.mock.calls.filter(
    ([url, init]) => `${init?.method ?? 'GET'} ${new URL(url).pathname}` === key
  )

function mount(props: Parameters<typeof SignInMethods>[0] = {}) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SignInMethods {...props} />
    </QueryClientProvider>
  )
}

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('offers to connect Google and sends the User to Google signed in', async () => {
  const fetch = fakeApi(
    { hasPassword: true, identities: [] },
    {
      'POST /api/v1/auth/google/start': () =>
        jsonResponse({
          authorizationUrl: 'https://accounts.example.test/auth?state=s',
        }),
    }
  )
  vi.stubGlobal('fetch', fetch)
  const navigate = vi.fn()
  const screen = await mount({ navigate })

  await screen.getByRole('button', { name: 'Connect Google' }).click()
  await vi.waitFor(() =>
    expect(navigate).toHaveBeenCalledWith(
      'https://accounts.example.test/auth?state=s'
    )
  )
  const [start] = calls(fetch, 'POST /api/v1/auth/google/start')
  expect(start[1].headers.get('Authorization')).toBe(
    `Bearer ${testSession().accessToken}`
  )
  expect(JSON.parse(start[1].body)).toEqual({ redirect: '/settings/account' })
})

it('shows the Google icon beside the connected account', async () => {
  vi.stubGlobal('fetch', fakeApi({ hasPassword: true, identities: [linked] }))
  const screen = await mount()
  await expect.element(screen.getByText('me@gmail.test')).toBeVisible()
  const row = screen.getByText('me@gmail.test').element().closest('div')
  expect(
    row?.parentElement?.querySelector('[data-slot="google-icon"]')
  ).not.toBeNull()
})

it('asks before disconnecting Google and only then removes it', async () => {
  const state: State = { hasPassword: true, identities: [linked] }
  const fetch = fakeApi(state)
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()

  await expect.element(screen.getByText('me@gmail.test')).toBeVisible()
  expect(
    screen
      .getByRole('button', { name: 'Connect Google', exact: true })
      .elements()
  ).toHaveLength(0)
  await screen.getByRole('button', { name: 'Disconnect Google' }).click()
  const dialog = screen.getByRole('alertdialog')
  await expect.element(dialog).toHaveTextContent('Disconnect Google?')
  await expect.element(dialog).toHaveTextContent('me@gmail.test')
  await expect.element(dialog).toHaveTextContent('connected apps')
  expect(calls(fetch, 'DELETE /api/v1/auth/identities/google')).toHaveLength(0)

  await screen.getByRole('button', { name: 'Cancel' }).click()
  expect(calls(fetch, 'DELETE /api/v1/auth/identities/google')).toHaveLength(0)

  state.identities = []
  await screen.getByRole('button', { name: 'Disconnect Google' }).click()
  await screen
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click()
  await expect
    .element(screen.getByRole('button', { name: 'Connect Google' }))
    .toBeVisible()
  expect(calls(fetch, 'DELETE /api/v1/auth/identities/google')).toHaveLength(1)
  expect(screen.getByRole('alertdialog').elements()).toHaveLength(0)
})

it('keeps the dialog open and says why when the server refuses the disconnect', async () => {
  vi.stubGlobal(
    'fetch',
    fakeApi(
      { hasPassword: true, identities: [linked] },
      {
        'DELETE /api/v1/auth/identities/google': () =>
          jsonResponse({ title: 'Set a password before unlinking' }, 409),
      }
    )
  )
  const screen = await mount()
  await screen.getByRole('button', { name: 'Disconnect Google' }).click()
  await screen
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click()
  await expect
    .element(screen.getByRole('alertdialog').getByRole('alert'))
    .toHaveTextContent('Set a password before unlinking')
})

it('offers the set-password link instead of disconnecting the only way to sign in', async () => {
  const fetch = fakeApi({ hasPassword: false, identities: [linked] })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await screen.getByRole('button', { name: 'Disconnect Google' }).click()
  const dialog = screen.getByRole('alertdialog')
  await expect.element(dialog).toHaveTextContent('only way you sign in')
  expect(
    dialog.getByRole('button', { name: 'Disconnect', exact: true }).elements()
  ).toHaveLength(0)
  expect(calls(fetch, 'DELETE /api/v1/auth/identities/google')).toHaveLength(0)

  await dialog.getByRole('button', { name: 'Send set-password link' }).click()
  const passwordDialog = screen.getByRole('dialog')
  await expect.element(passwordDialog).toHaveTextContent('Set a password')
  await expect.element(passwordDialog).toHaveTextContent('user@example.com')
})

it('sends the link to the account email from a confirmation dialog', async () => {
  const fetch = fakeApi({ hasPassword: false, identities: [linked] })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect.element(screen.getByText('Not set')).toBeVisible()
  await screen.getByRole('button', { name: 'Set password' }).click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog).toHaveTextContent('Set a password')
  await expect.element(dialog).toHaveTextContent('user@example.com')
  await expect.element(dialog).toHaveTextContent('expires in 1 hour')
  expect(calls(fetch, 'POST /api/v1/auth/password/link')).toHaveLength(0)

  await dialog.getByRole('button', { name: 'Send link' }).click()
  await expect.element(dialog).toHaveTextContent('Check your inbox')
  expect(calls(fetch, 'POST /api/v1/auth/password/link')).toHaveLength(1)
  await expect
    .element(dialog.getByRole('button', { name: /Send again/ }))
    .toBeDisabled()
})

it('offers Change password to a User who already has one', async () => {
  vi.stubGlobal('fetch', fakeApi({ hasPassword: true, identities: [] }))
  const screen = await mount()
  await expect.element(screen.getByText('Password is set')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Set password' }).elements()
  ).toHaveLength(0)
  await screen.getByRole('button', { name: 'Change password' }).click()
  await expect
    .element(screen.getByRole('dialog'))
    .toHaveTextContent('Change your password')
})

it.each([
  [429, 'Wait a minute before asking again.'],
  [403, 'Verify your email before'],
  [502, 'could not be sent'],
  [503, 'not set up'],
  [500, 'Could not send the link'],
])('explains a %s when sending the link', async (status, message) => {
  vi.stubGlobal(
    'fetch',
    fakeApi(
      { hasPassword: true, identities: [] },
      {
        'POST /api/v1/auth/password/link': () =>
          jsonResponse({ title: 'x' }, status),
      }
    )
  )
  const screen = await mount()
  await screen.getByRole('button', { name: 'Change password' }).click()
  await screen
    .getByRole('dialog')
    .getByRole('button', { name: 'Send link' })
    .click()
  await expect
    .element(screen.getByRole('dialog').getByRole('alert'))
    .toHaveTextContent(message)
})

it.each([
  ['google', undefined, /Google account connected/, 'status'],
  [undefined, 'identity_in_use', /already connected to another user/, 'alert'],
  [
    undefined,
    'provider_linked',
    /different Google account is already connected/,
    'alert',
  ],
  [undefined, 'denied', /cancelled/, 'alert'],
  [undefined, 'whatever', /could not be connected/, 'alert'],
])(
  'reports the result of linking: linked=%s error=%s',
  async (linkedParam, error, text, role) => {
    vi.stubGlobal('fetch', fakeApi({ hasPassword: true, identities: [] }))
    const screen = await mount({ linked: linkedParam, linkError: error })
    await expect
      .element(screen.getByRole(role as 'status' | 'alert'))
      .toHaveTextContent(text)
  }
)

it('reports a failure to load the sign-in methods and offers a retry', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(jsonResponse({ title: 'down' }, 503))
  )
  const screen = await mount()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Could not load')
  await expect
    .element(screen.getByRole('button', { name: 'Retry' }))
    .toBeVisible()
})
