import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { AINotifications, AIUsage } from './usage-and-notifications'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

const wrap = (node: React.ReactNode) => {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>
  )
}

it('says how much of this month is used and when it starts over', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          used: 1_200_000,
          limit: 3_000_000,
          resetsAt: '2026-11-01T00:00:00Z',
        })
      )
    )
  )
  const screen = await wrap(<AIUsage workspaceID={workspaceID} />)
  await expect.element(screen.getByText('1.2M of 3M tokens')).toBeVisible()
  await expect.element(screen.getByText(/resets on Nov 1/)).toBeVisible()
  await expect
    .element(screen.getByRole('progressbar', { name: /AI use this month/ }))
    .toHaveAttribute('aria-valuenow', '40')
})

it('says so when the use cannot be read', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ title: 'down' }, 500)))
  )
  const screen = await wrap(<AIUsage workspaceID={workspaceID} />)
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Could not read this month')
})

it('keeps the two notification switches for this browser', async () => {
  const screen = await wrap(<AINotifications />)
  const sound = screen.getByRole('checkbox', {
    name: 'Play notification sound when completed',
  })
  await expect.element(sound).not.toBeChecked()
  await userEvent.click(sound)
  expect(
    JSON.parse(localStorage.getItem('dokudocs.chat-preferences')!)
  ).toEqual({ sound: true, browser: false })
  await expect
    .element(screen.getByText('Applies to this browser only.'))
    .toBeVisible()
})
