import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { PlatformMCPPage } from '.'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`
const settings = {
  enabled: true,
  readPerMinute: 60,
  writePerMinute: 10,
  maxResultBytes: 204800,
  auditRetentionDays: 90,
  updatedAt: '2026-10-11T10:00:00Z',
}

function mount() {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlatformMCPPage />
    </QueryClientProvider>
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('switches MCP off and changes the limits', async () => {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    if (route === 'GET /api/v1/platform/mcp')
      return Promise.resolve(jsonResponse(settings))
    if (route === 'PUT /api/v1/platform/mcp')
      return Promise.resolve(
        jsonResponse({ ...settings, ...JSON.parse(String(init?.body)) })
      )
    if (route === 'GET /api/v1/platform/mcp/audit')
      return Promise.resolve(jsonResponse({ entries: [] }))
    return Promise.resolve(jsonResponse({}, 404))
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect
    .element(screen.getByLabelText('Reads per minute, per key'))
    .toHaveValue(60)
  await userEvent.click(screen.getByRole('switch', { name: 'MCP is on' }))
  await userEvent.fill(screen.getByLabelText('Writes per minute, per key'), '5')
  await userEvent.click(
    screen.getByRole('button', { name: 'Save MCP settings' })
  )
  await expect.element(screen.getByText('MCP settings saved.')).toBeVisible()
  const [, init] = fetch.mock.calls.find(
    ([url, i]) => key(url, i) === 'PUT /api/v1/platform/mcp'
  )!
  expect(JSON.parse(String(init?.body))).toMatchObject({
    enabled: false,
    writePerMinute: 5,
    readPerMinute: 60,
  })
  await expect.element(screen.getByText('No MCP calls yet.')).toBeVisible()
})

it('says only a superadmin can open the page', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({ title: 'only a superadmin can do this' }, 403)
      )
    )
  )
  const screen = await mount()
  await expect
    .element(screen.getByText('Only a superadmin can open this page.'))
    .toBeVisible()
})
