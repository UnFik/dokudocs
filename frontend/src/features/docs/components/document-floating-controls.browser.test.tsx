import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { clearCookies } from '@/test-utils/cookies'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { ThemeProvider } from '@/context/theme-provider'
import { DocumentFloatingControls } from './document-floating-controls'

const chat = {
  documentID: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
  workspaceID: '149a8d07-8490-43ed-98fa-ebaa91b05e90',
  title: 'Runbook',
}

beforeEach(() => {
  clearCookies()
  document.documentElement.classList.remove('dark')
  document.documentElement.classList.add('light')
})
afterEach(() => vi.unstubAllGlobals())

async function mount(withChat: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme='light'>
        <DocumentFloatingControls chat={withChat ? chat : undefined} />
      </ThemeProvider>
    </QueryClientProvider>
  )
}

it('stacks the theme button above Ask AI, with Ask AI at the very bottom right', async () => {
  const screen = await mount(true)
  const theme = screen.getByRole('button', { name: 'Toggle theme' })
  const ask = screen.getByRole('button', { name: 'Ask AI' })
  await expect.element(theme).toBeVisible()
  await expect.element(ask).toBeVisible()
  const themeBox = theme.element().getBoundingClientRect()
  const askBox = ask.element().getBoundingClientRect()
  expect(themeBox.bottom).toBeLessThanOrEqual(askBox.top)
  // Ask AI is the lowest thing in the corner: 16px from the bottom and right edges.
  expect(Math.round(window.innerHeight - askBox.bottom)).toBe(16)
  expect(Math.round(window.innerWidth - askBox.right)).toBe(16)
  // Both line up on the right edge.
  expect(Math.abs(themeBox.right - askBox.right)).toBeLessThan(1)
})

it('shows only the theme button on a document that has no chat', async () => {
  const screen = await mount(false)
  await expect
    .element(screen.getByRole('button', { name: 'Toggle theme' }))
    .toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Ask AI' }).elements()
  ).toHaveLength(0)
})

it('switches the theme with the button', async () => {
  const screen = await mount(false)
  await userEvent.click(screen.getByRole('button', { name: 'Toggle theme' }))
  await vi.waitFor(() =>
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  )
  await userEvent.click(screen.getByRole('button', { name: 'Toggle theme' }))
  await vi.waitFor(() =>
    expect(document.documentElement.classList.contains('light')).toBe(true)
  )
})
