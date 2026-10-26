import '@/styles/index.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { CHAT_COLUMN_WIDTH } from './chat-column-width'
import {
  AskAIButton,
  DocumentChatColumn,
  DocumentChatProvider,
} from './document-chat-panel'

vi.mock('./document-chat-panel-body', () => ({ default: () => null }))

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function mount() {
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse([])))
  )
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DocumentChatProvider
        documentID={documentID}
        workspaceID={workspaceID}
        title='Spec'
      >
        <AskAIButton />
        <DocumentChatColumn />
      </DocumentChatProvider>
    </QueryClientProvider>
  )
}

const openKey = () =>
  `dokudocs.askAIPanelOpen:${useAuthStore.getState().auth.user?.id ?? ''}`
const widthKey = () =>
  `dokudocs.askAIPanelWidth:${useAuthStore.getState().auth.user?.id ?? ''}`

const pointer = (target: Element, type: string, x: number) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: 100,
      pointerId: 1,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      isPrimary: true,
    })
  )

it('widens the column when its left edge is dragged, and keeps the width when it is reopened', async () => {
  await page.viewport(1280, 800)
  useAuthStore.getState().auth.setSession(testSession())
  localStorage.setItem(openKey(), '1')
  const screen = await mount()

  const handle = page.getByRole('separator', { name: 'Resize the AI chat' })
  await expect
    .element(handle)
    .toHaveAttribute('aria-valuenow', String(CHAT_COLUMN_WIDTH.default))

  const edge = handle.element()
  const x = edge.getBoundingClientRect().x
  pointer(edge, 'pointerdown', x)
  pointer(edge, 'pointermove', x - 40)
  pointer(edge, 'pointerup', x - 40)

  await expect.element(handle).toHaveAttribute('aria-valuenow', '424')
  const column = document.getElementById('ask-ai-panel')!
  expect(column.style.getPropertyValue('--chat-column-width')).toBe('424px')
  expect(localStorage.getItem(widthKey())).toBe('424')

  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  expect(document.getElementById('ask-ai-panel')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await expect
    .element(page.getByRole('separator', { name: 'Resize the AI chat' }))
    .toHaveAttribute('aria-valuenow', '424')
})
