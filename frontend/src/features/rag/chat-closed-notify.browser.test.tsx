import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { controlledStream } from '@/test-utils/sse'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { DocumentChatPanel } from './document-chat-panel'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const conversationID = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const runID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

const shown: { title: string; body?: string }[] = []

beforeEach(() => {
  localStorage.clear()
  shown.length = 0
  localStorage.setItem(
    'dokudocs.chat-preferences',
    JSON.stringify({ sound: false, browser: true })
  )
  class FakeNotification {
    static permission = 'granted'
    constructor(title: string, options?: { body?: string }) {
      shown.push({ title, body: options?.body })
    }
  }
  vi.stubGlobal('Notification', FakeNotification)
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('tells the User an answer is ready after they closed the panel while it was written', async () => {
  let unread = false
  const stream = controlledStream()
  const chat = () => ({
    id: conversationID,
    workspaceId: workspaceID,
    documentId: documentID,
    title: 'Deploy checklist',
    unread,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const route = key(url, init)
      if (route === `GET /api/v1/rag/documents/${documentID}/conversations`)
        return Promise.resolve(jsonResponse([chat()]))
      if (route === `GET /api/v1/rag/conversations/${conversationID}`)
        return Promise.resolve(
          jsonResponse({ conversation: chat(), messages: [], actions: [] })
        )
      if (route === `GET /api/v1/rag/conversations/${conversationID}/runs`)
        return Promise.resolve(jsonResponse(null))
      if (route === `POST /api/v1/rag/conversations/${conversationID}/runs`)
        return Promise.resolve(
          jsonResponse(
            {
              id: runID,
              kind: 'chat',
              status: 'running',
              draft: '',
              sequence: 0,
            },
            202
          )
        )
      if (route === `GET /api/v1/ai/runs/${runID}/events`)
        return Promise.resolve(stream.response())
      if (route === 'GET /api/v1/skills')
        return Promise.resolve(jsonResponse({ skills: [] }))
      return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
    })
  )
  useAuthStore.getState().auth.setSession(testSession())
  const screen = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DocumentChatPanel
        documentID={documentID}
        workspaceID={workspaceID}
        title='Spec'
      />
    </QueryClientProvider>
  )
  await userEvent.click(screen.getByRole('button', { name: /Ask AI/ }))
  await userEvent.fill(
    screen.getByRole('textbox', { name: 'Ask a question' }),
    'How do I ship?'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await expect
    .element(screen.getByRole('button', { name: 'Stop' }))
    .toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(shown).toEqual([])

  // The server finishes the answer while the panel is shut.
  unread = true
  await vi.waitFor(() => expect(shown).toHaveLength(1), { timeout: 25_000 })
  expect(shown[0]).toEqual({
    title: 'DokuDocs AI',
    body: 'Deploy checklist: the answer is ready.',
  })
}, 40_000)
