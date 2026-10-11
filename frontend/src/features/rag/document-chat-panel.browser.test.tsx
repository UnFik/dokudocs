import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { DocumentChatPanel } from './document-chat-panel'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const conversationID = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const conversation = {
  id: conversationID,
  workspaceId: workspaceID,
  documentId: documentID,
  title: '',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function mount() {
  useAuthStore.getState().auth.setSession(testSession())
  return render(
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
}

it('opens a chat about this document and asks in it', async () => {
  let created = false
  let messages: unknown[] = []
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    if (route === `GET /api/v1/rag/documents/${documentID}/conversations`)
      return Promise.resolve(jsonResponse(created ? [conversation] : []))
    if (route === 'POST /api/v1/rag/conversations') {
      created = true
      return Promise.resolve(jsonResponse(conversation, 201))
    }
    if (route === `GET /api/v1/rag/conversations/${conversationID}`)
      return Promise.resolve(
        jsonResponse({ conversation, messages, actions: [] })
      )
    if (route === `POST /api/v1/rag/conversations/${conversationID}/messages`) {
      messages = [
        {
          id: '1f27eac4-3eea-4ced-b4fa-e7f6b1c81ed4',
          conversationId: conversationID,
          role: 'user',
          content: 'Summarize',
          createdAt: '2026-10-01T00:00:00Z',
        },
        {
          id: '2f27eac4-3eea-4ced-b4fa-e7f6b1c81ed4',
          conversationId: conversationID,
          role: 'assistant',
          content: 'It covers sign-in.',
          createdAt: '2026-10-01T00:00:01Z',
        },
      ]
      return Promise.resolve(
        jsonResponse({
          conversationId: conversationID,
          text: 'It covers sign-in.',
          citations: [],
          coveragePartial: false,
          sourcesMayBeIncomplete: false,
        })
      )
    }
    if (route === 'GET /api/v1/skills')
      return Promise.resolve(jsonResponse({ skills: [] }))
    return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await expect
    .element(screen.getByText('No chats about this document yet.'))
    .toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'New chat' }))
  const [, createInit] = fetch.mock.calls.find(
    ([url, init]) => key(url, init) === 'POST /api/v1/rag/conversations'
  )!
  expect(JSON.parse(String(createInit?.body))).toEqual({
    documentId: documentID,
  })
  await userEvent.fill(
    screen.getByRole('textbox', { name: 'Ask a question' }),
    'Summarize'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await expect.element(screen.getByText('It covers sign-in.')).toBeVisible()
})

it('says when the chats cannot be loaded', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ title: 'down' }, 500)))
  )
  const screen = await mount()
  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await expect
    .element(screen.getByText('Could not load the chats about this document.'))
    .toBeVisible()
})
