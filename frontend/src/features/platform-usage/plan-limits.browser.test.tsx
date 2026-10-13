import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { PlanLimits } from './plan-limits'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function mount(
  respond: (route: string, body: unknown) => Response = () =>
    jsonResponse({ title: 'not found' }, 404)
) {
  const calls: { route: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const route = key(url, init)
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ route, body })
      if (route === 'GET /api/v1/platform/ai/limits')
        return Promise.resolve(
          jsonResponse({
            limits: [
              { plan: 'Free', monthlyTokens: 300000 },
              { plan: 'Pro', monthlyTokens: 3000000 },
            ],
          })
        )
      return Promise.resolve(respond(route, body))
    })
  )
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlanLimits />
    </QueryClientProvider>
  ).then((screen) => ({ screen, calls }))
}

it('lists what each Plan allows and saves a changed limit', async () => {
  const { screen, calls } = await mount((route) =>
    route.startsWith('PUT')
      ? jsonResponse({ plan: 'Pro', monthlyTokens: 5000000 })
      : jsonResponse({}, 404)
  )
  const pro = screen.getByRole('spinbutton', { name: 'Pro tokens per month' })
  await expect.element(pro).toHaveValue(3000000)
  await userEvent.fill(pro, '5000000')
  await userEvent.click(screen.getByRole('button', { name: 'Save Pro' }))
  await vi.waitFor(() =>
    expect(calls.find((c) => c.route.startsWith('PUT'))).toEqual({
      route: 'PUT /api/v1/platform/ai/limits/Pro',
      body: { monthlyTokens: 5000000 },
    })
  )
})

it('adds a limit for a Plan that has none yet', async () => {
  const { screen, calls } = await mount((route) =>
    route.startsWith('PUT') ? jsonResponse({}) : jsonResponse({}, 404)
  )
  await userEvent.fill(
    screen.getByRole('textbox', { name: 'Plan name' }),
    'Team'
  )
  await userEvent.fill(
    screen.getByRole('spinbutton', {
      name: 'Tokens per month for the new Plan',
    }),
    '2000000'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add Plan' }))
  await vi.waitFor(() =>
    expect(calls.find((c) => c.route.startsWith('PUT'))?.route).toBe(
      'PUT /api/v1/platform/ai/limits/Team'
    )
  )
})

it('shows why the server refused a limit', async () => {
  const { screen } = await mount((route) =>
    route.startsWith('PUT')
      ? jsonResponse({ title: 'a limit needs a whole number of tokens' }, 400)
      : jsonResponse({}, 404)
  )
  await userEvent.click(screen.getByRole('button', { name: 'Save Free' }))
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('a limit needs a whole number of tokens')
})

it('says so when the limits cannot be read', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ title: 'down' }, 500)))
  )
  useAuthStore.getState().auth.setSession(testSession())
  const screen = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlanLimits />
    </QueryClientProvider>
  )
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Could not read the usage limits')
})
