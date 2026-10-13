import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { UserQuotas } from './user-quotas'

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

const quotas = [
  {
    userId: 'u1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    workspaceId: 'w1',
    workspace: 'Engines',
    plan: 'Free',
    used: 150000,
    limit: 300000,
  },
  {
    userId: 'u2',
    name: '',
    email: 'bob@example.com',
    workspaceId: 'w1',
    workspace: 'Engines',
    plan: 'Free',
    used: 1000,
    limit: 300000,
  },
]

it('lists the spend per user and resets one allowance after a confirmation', async () => {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const route = `${init?.method ?? 'GET'} ${new URL(url).pathname}`
      calls.push(route)
      if (route === 'GET /api/v1/platform/ai/quotas')
        return Promise.resolve(jsonResponse({ quotas }))
      if (route === 'POST /api/v1/platform/ai/quotas/w1/u1/reset')
        return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
    })
  )
  useAuthStore.getState().auth.setSession(testSession())
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <UserQuotas />
    </QueryClientProvider>
  )
  await expect.element(screen.getByText('ada@example.com')).toBeVisible()
  await expect.element(screen.getByText('50%')).toBeVisible()

  await userEvent.fill(screen.getByRole('searchbox'), 'bob')
  await expect
    .element(screen.getByText('ada@example.com'))
    .not.toBeInTheDocument()
  await userEvent.clear(screen.getByRole('searchbox'))

  await userEvent.click(
    screen.getByRole('button', { name: 'Reset Ada Lovelace in Engines' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'Reset allowance' }))
  await vi.waitFor(() =>
    expect(calls).toContain('POST /api/v1/platform/ai/quotas/w1/u1/reset')
  )
})
