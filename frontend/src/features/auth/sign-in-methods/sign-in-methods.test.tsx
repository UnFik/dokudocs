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

it('lists the connected account and disconnects it', async () => {
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
  state.identities = []
  await screen.getByRole('button', { name: 'Disconnect Google' }).click()
  await expect
    .element(screen.getByRole('button', { name: 'Connect Google' }))
    .toBeVisible()
  expect(calls(fetch, 'DELETE /api/v1/auth/identities/google')).toHaveLength(1)
})

it('says why the only way to sign in cannot be removed', async () => {
  vi.stubGlobal(
    'fetch',
    fakeApi(
      { hasPassword: false, identities: [linked] },
      {
        'DELETE /api/v1/auth/identities/google': () =>
          jsonResponse({ title: 'Set a password first' }, 409),
      }
    )
  )
  const screen = await mount()
  await screen.getByRole('button', { name: 'Disconnect Google' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Set a password first')
})

it('lets a User without a password set one, and then stops asking', async () => {
  const state: State = { hasPassword: false, identities: [linked] }
  const fetch = fakeApi(state)
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()

  const field = screen.getByLabelText('New password')
  await field.fill('too short')
  await screen.getByRole('button', { name: 'Set password' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('at least 15')
  expect(calls(fetch, 'POST /api/v1/auth/password')).toHaveLength(0)

  state.hasPassword = true
  await field.fill('a long enough password')
  await screen.getByRole('button', { name: 'Set password' }).click()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('Password set')
  expect(
    JSON.parse(calls(fetch, 'POST /api/v1/auth/password')[0][1].body)
  ).toEqual({
    password: 'a long enough password',
  })
  expect(screen.getByLabelText('New password').elements()).toHaveLength(0)
})

it('does not offer a password to a User who has one', async () => {
  vi.stubGlobal('fetch', fakeApi({ hasPassword: true, identities: [] }))
  const screen = await mount()
  await expect
    .element(screen.getByRole('button', { name: 'Connect Google' }))
    .toBeVisible()
  expect(screen.getByLabelText('New password').elements()).toHaveLength(0)
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
