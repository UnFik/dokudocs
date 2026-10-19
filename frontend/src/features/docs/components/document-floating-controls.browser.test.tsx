import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { clearCookies } from '@/test-utils/cookies'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { ThemeProvider } from '@/context/theme-provider'
import {
  AskAIButton,
  DocumentChatColumn,
  DocumentChatProvider,
} from '@/features/rag/document-chat-panel'
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
afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme='light'>
        <DocumentChatProvider {...chat}>
          <div className='flex h-screen'>
            <div className='min-w-0 flex-1' />
            <DocumentChatColumn />
          </div>
          <DocumentFloatingControls />
          <AskAIButton />
        </DocumentChatProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

it('keeps the theme button 16px from the bottom right corner', async () => {
  const screen = await mount()
  const theme = screen.getByRole('button', { name: 'Toggle theme' })
  await expect.element(theme).toBeVisible()
  const box = theme.element().getBoundingClientRect()
  expect(Math.round(window.innerHeight - box.bottom)).toBe(16)
  expect(Math.round(window.innerWidth - box.right)).toBe(16)
})

it('steps the theme button left of the chat column while it is open', async () => {
  await page.viewport(1280, 800)
  const screen = await mount()
  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  const column = screen.getByRole('complementary', {
    name: 'AI chat about Runbook',
  })
  await expect.element(column).toBeVisible()
  const theme = screen.getByRole('button', { name: 'Toggle theme' })
  expect(theme.element().getBoundingClientRect().right).toBeLessThanOrEqual(
    column.element().getBoundingClientRect().left
  )
})

it('remembers that the chat column is open for the next document', async () => {
  await page.viewport(1280, 800)
  const first = await mount()
  await userEvent.click(first.getByRole('button', { name: 'Ask AI' }))
  await first.unmount()
  const second = await mount()
  await expect
    .element(
      second.getByRole('complementary', { name: 'AI chat about Runbook' })
    )
    .toBeVisible()
  await userEvent.click(second.getByRole('button', { name: 'Close' }))
  expect(
    second
      .getByRole('complementary', { name: 'AI chat about Runbook' })
      .elements()
  ).toHaveLength(0)
})
