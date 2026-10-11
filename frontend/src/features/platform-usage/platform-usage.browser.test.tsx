import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { PlatformUsagePage } from '.'

const total = (calls: number, input: number, output: number, failed = 0) => ({
  calls,
  failed,
  inputTokens: input,
  outputTokens: output,
})
const summary = {
  since: '2026-10-05T00:00:00Z',
  overall: total(12, 15000, 900, 1),
  days: [{ day: '2026-10-11', ...total(12, 15000, 900, 1) }],
  models: [
    { provider: 'openai', model: 'gpt-agent', ...total(10, 14000, 880) },
  ],
  purposes: [
    { purpose: 'agent', feature: 'chat_document', ...total(10, 14000, 880) },
  ],
  topUsers: [
    {
      userId: 'b4d13df7-76a2-4da5-8817-91d40f832abd',
      name: 'Ana',
      email: 'ana@example.com',
      ...total(9, 12000, 700),
    },
  ],
}

function mount() {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PlatformUsagePage />
    </QueryClientProvider>
  )
}
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('shows tokens by model, use and user, for the chosen period', async () => {
  const fetch = vi.fn((_url: string) => Promise.resolve(jsonResponse(summary)))
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await expect.element(screen.getByText('gpt-agent')).toBeVisible()
  await expect.element(screen.getByText('Chat in a document')).toBeVisible()
  await expect.element(screen.getByText('Ana')).toBeVisible()
  await expect.element(screen.getByText('15,000').first()).toBeVisible()
  await userEvent.selectOptions(screen.getByLabelText('Period'), '7')
  expect(fetch.mock.calls.some(([url]) => String(url).includes('days=7'))).toBe(
    true
  )
})

it('explains an empty period', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          ...summary,
          overall: total(0, 0, 0),
          days: [],
          models: [],
          purposes: [],
          topUsers: [],
        })
      )
    )
  )
  const screen = await mount()
  await expect
    .element(screen.getByText(/No model calls in this period/))
    .toBeVisible()
})
