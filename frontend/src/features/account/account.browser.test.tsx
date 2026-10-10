import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { AccountPage } from '.'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

// The page asks for the profile and for the sign-in methods; answer each by path.
function api(
  profile: () => Response,
  answers: Record<string, () => Response> = {}
) {
  return vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    if (answers[route]) return Promise.resolve(answers[route]())
    return Promise.resolve(
      route === 'GET /api/v1/auth/identities'
        ? jsonResponse({ hasPassword: true, identities: [] })
        : profile()
    )
  })
}
const calls = (fetch: ReturnType<typeof vi.fn>, route: string) =>
  fetch.mock.calls.filter(([url, init]) => key(url, init) === route)

function mount(props: Parameters<typeof AccountPage>[0] = {}) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AccountPage {...props} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function signedIn(extra: Record<string, string> = {}) {
  const { user } = testSession()
  useAuthStore.getState().auth.setSession(testSession())
  return () =>
    jsonResponse({
      id: user.id,
      email: user.email,
      fullName: 'Current Person',
      bio: 'My profile',
      phoneNumber: '',
      avatarUrl: '',
      ...extra,
    })
}

it('shows the profile, with the email as plain text rather than a field', async () => {
  const { user } = testSession()
  vi.stubGlobal('fetch', api(signedIn()))
  const screen = await mount()
  await expect
    .element(screen.getByLabelText('Full Name'))
    .toHaveValue('Current Person')
  await expect.element(screen.getByLabelText('Bio')).toHaveValue('My profile')
  await expect.element(screen.getByText(user.email)).toBeVisible()
  expect(screen.getByLabelText('Email Address').elements()).toHaveLength(0)
  expect(screen.getByLabelText('Email').elements()).toHaveLength(0)
  await expect
    .element(screen.getByRole('button', { name: 'Save Changes' }))
    .toBeDisabled()
})

it('saves the name, phone and bio and then waits for the next change', async () => {
  const fetch = api(signedIn(), {
    'PUT /api/v1/users/me/profile': () =>
      jsonResponse({
        fullName: 'New Name',
        phoneNumber: '123',
        bio: 'My profile',
      }),
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  const save = screen.getByRole('button', { name: 'Save Changes' })
  await screen.getByLabelText('Full Name').fill('New Name')
  await screen.getByLabelText('Phone Number').fill('123')
  await expect.element(save).toBeEnabled()
  await save.click()

  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('Profile saved')
  expect(
    JSON.parse(calls(fetch, 'PUT /api/v1/users/me/profile')[0][1].body)
  ).toEqual({
    fullName: 'New Name',
    phoneNumber: '123',
    bio: 'My profile',
  })
  expect(
    JSON.stringify(calls(fetch, 'PUT /api/v1/users/me/profile')[0][1].body)
  ).not.toContain('avatar')
})

it('does not send a name that is too short, and says what to fix', async () => {
  const fetch = api(signedIn())
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await screen.getByLabelText('Full Name').fill('A')
  await screen.getByRole('button', { name: 'Save Changes' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('between 2 and 100 characters')
  expect(calls(fetch, 'PUT /api/v1/users/me/profile')).toHaveLength(0)

  await screen.getByLabelText('Full Name').fill('Current Person')
  await screen.getByLabelText('Phone Number').fill('1'.repeat(31))
  await screen.getByRole('button', { name: 'Save Changes' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('30 characters')
})

it('reports a failed save and keeps what was typed', async () => {
  vi.stubGlobal(
    'fetch',
    api(signedIn(), {
      'PUT /api/v1/users/me/profile': () =>
        jsonResponse({ title: 'failed to update profile' }, 500),
    })
  )
  const screen = await mount()
  await screen.getByLabelText('Full Name').fill('New Name')
  await screen.getByRole('button', { name: 'Save Changes' }).click()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('failed to update profile')
  await expect
    .element(screen.getByLabelText('Full Name'))
    .toHaveValue('New Name')
})

it('falls back to signed-in email on a profile server failure without logging out', async () => {
  const session = testSession()
  useAuthStore.getState().auth.setSession(session)
  vi.stubGlobal(
    'fetch',
    api(() => jsonResponse({ title: 'Unavailable' }, 503))
  )
  const screen = await mount()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Profile unavailable')
  await expect
    .element(screen.getByLabelText('Full Name'))
    .toHaveValue(session.user.email)
  await expect
    .element(screen.getByLabelText('Full Name'))
    .toHaveAttribute('readonly')
  await expect
    .element(screen.getByRole('button', { name: 'Save Changes' }))
    .toBeDisabled()
  expect(useAuthStore.getState().auth.user).toEqual(session.user)
})

it('shows the sign-in methods and the result of connecting an account', async () => {
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    api(() => jsonResponse({ title: 'Unavailable' }, 503))
  )
  const screen = await mount({ linked: 'google' })
  await expect
    .element(screen.getByRole('heading', { name: 'Sign-in methods' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Connect Google' }))
    .toBeVisible()
  await expect
    .element(screen.getByText('Google account connected.'))
    .toBeVisible()
})
