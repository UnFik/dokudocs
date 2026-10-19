import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import {
  AskAIButton,
  DocumentChatColumn,
  DocumentChatProvider,
} from './document-chat-panel'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const conversation = {
  id: '65b7593c-3a2d-45a4-a47d-47e8a1c8136b',
  workspaceId: workspaceID,
  documentId: documentID,
  title: 'Spec',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}
const messages = Array.from({ length: 40 }, (_, index) => ({
  id: `${index.toString(16).padStart(8, '0')}-3eea-4ced-b4fa-e7f6b1c81ed4`,
  conversationId: conversation.id,
  role: index % 2 ? 'assistant' : 'user',
  content: 'A paragraph.\n\nAnother one that wraps.\n\n```ts\nconst x = 1\n```',
  createdAt: `2026-10-01T00:00:${String(index).padStart(2, '0')}Z`,
}))

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

// The layout the document page gives the column: a row exactly one screen high.
it('keeps a long chat inside its column, so the page does not scroll on a wide screen', async () => {
  await page.viewport(1280, 800)
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = new URL(url).pathname
      if (path.endsWith('/conversations'))
        return Promise.resolve(jsonResponse([conversation]))
      if (path === `/api/v1/rag/conversations/${conversation.id}`)
        return Promise.resolve(
          jsonResponse({ conversation, messages, actions: [] })
        )
      return Promise.resolve(jsonResponse([]))
    })
  )
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentChatProvider
        documentID={documentID}
        workspaceID={workspaceID}
        title='Spec'
      >
        <div className='flex h-screen w-full'>
          <div className='min-w-0 flex-1'>
            <AskAIButton />
          </div>
          <DocumentChatColumn />
        </div>
      </DocumentChatProvider>
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await expect
    .poll(
      () => document.querySelector<HTMLElement>('[role=log]')?.scrollHeight,
      { timeout: 5000 }
    )
    .toBeGreaterThan(window.innerHeight * 2)

  expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(
    window.innerHeight
  )
})
