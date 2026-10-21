import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { controlledStream, sseFrame } from '@/test-utils/sse'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { useDocumentChatPanel } from './chat-panel-context'
import {
  DocumentChatColumn,
  DocumentChatPanel,
  DocumentChatProvider,
} from './document-chat-panel'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const runID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
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
  localStorage.clear()
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

it('shows the answer as it is written, saves it only when done, and offers Stop', async () => {
  let created = false
  let cancelled = false
  let messages: unknown[] = []
  const stream = controlledStream()
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
    if (route === `POST /api/v1/ai/runs/${runID}/cancel`) {
      cancelled = true
      stream.send(sseFrame(5, 'cancelled', { id: runID, draft: 'It cov' }))
      return Promise.resolve(
        jsonResponse({
          id: runID,
          kind: 'chat',
          status: 'cancelled',
          draft: 'It cov',
          sequence: 5,
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

  // Text shows before the server has finished, as a draft.
  stream.send(sseFrame(1, 'status', { phase: 'answering' }))
  stream.send(sseFrame(2, 'text_delta', { text: 'It cov' }))
  await expect.element(screen.getByText('It cov')).toBeVisible()
  await expect.element(screen.getByText(/dokudocs ai · draft/)).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Stop' }))
    .toBeVisible()
  expect(messages).toHaveLength(0)

  stream.send(sseFrame(3, 'text_delta', { text: 'ers sign-in.' }))
  await expect.element(screen.getByText('It covers sign-in.')).toBeVisible()

  // The server saves the pair and ends the run; the chat history takes over.
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
  stream.send(sseFrame(4, 'completed', { id: runID }))
  await expect
    .element(screen.getByRole('button', { name: 'Send' }))
    .toBeVisible()
  await expect.element(screen.getByText(/draft/)).not.toBeInTheDocument()
  await expect.element(screen.getByText('It covers sign-in.')).toBeVisible()
  expect(cancelled).toBe(false)
})

it('stops the answer and keeps the draft labelled as not saved', async () => {
  let cancelled = false
  const stream = controlledStream()
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    if (route === `GET /api/v1/rag/documents/${documentID}/conversations`)
      return Promise.resolve(jsonResponse([conversation]))
    if (route === `GET /api/v1/rag/conversations/${conversationID}`)
      return Promise.resolve(
        jsonResponse({ conversation, messages: [], actions: [] })
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
    if (route === `POST /api/v1/ai/runs/${runID}/cancel`) {
      cancelled = true
      stream.send(sseFrame(3, 'cancelled', { id: runID, draft: 'It cov' }))
      return Promise.resolve(
        jsonResponse({
          id: runID,
          kind: 'chat',
          status: 'cancelled',
          draft: 'It cov',
          sequence: 3,
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
  await userEvent.fill(
    screen.getByRole('textbox', { name: 'Ask a question' }),
    'Summarize'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  stream.send(sseFrame(1, 'text_delta', { text: 'It cov' }))
  await expect.element(screen.getByText('It cov')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
  await expect
    .element(screen.getByText(/This draft was not saved to the chat/))
    .toBeVisible()
  expect(cancelled).toBe(true)
  await expect
    .element(screen.getByRole('button', { name: 'Send' }))
    .toBeVisible()
})

it('picks up an answer already being written when the panel opens', async () => {
  const stream = controlledStream()
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    if (route === `GET /api/v1/rag/documents/${documentID}/conversations`)
      return Promise.resolve(jsonResponse([conversation]))
    if (route === `GET /api/v1/rag/conversations/${conversationID}`)
      return Promise.resolve(
        jsonResponse({ conversation, messages: [], actions: [] })
      )
    if (route === `GET /api/v1/rag/conversations/${conversationID}/runs`)
      return Promise.resolve(
        jsonResponse({
          id: runID,
          kind: 'chat',
          status: 'running',
          draft: 'Already writ',
          sequence: 4,
        })
      )
    if (route === `GET /api/v1/ai/runs/${runID}/events`)
      return Promise.resolve(stream.response())
    if (route === 'GET /api/v1/skills')
      return Promise.resolve(jsonResponse({ skills: [] }))
    return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
  })
  vi.stubGlobal('fetch', fetch)
  const screen = await mount()
  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await expect.element(screen.getByText('Already writ')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Stop' }))
    .toBeVisible()
})

function EditorStandIn() {
  const chat = useDocumentChatPanel()
  return (
    <>
      <button
        type='button'
        onClick={() => chat?.addToChat({ name: 'Hello · L3', text: 'Hello' })}
      >
        Add selection
      </button>
      <button type='button' onClick={() => chat?.openChat()}>
        Open chat
      </button>
    </>
  )
}

function mountWithEditor() {
  useAuthStore.getState().auth.setSession(testSession())
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
        <EditorStandIn />
        <DocumentChatColumn />
      </DocumentChatProvider>
    </QueryClientProvider>
  )
}

function stubChatWithOneConversation() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const route = key(url, init)
      if (route === `GET /api/v1/rag/documents/${documentID}/conversations`)
        return Promise.resolve(jsonResponse([conversation]))
      if (route === `GET /api/v1/rag/conversations/${conversationID}`)
        return Promise.resolve(
          jsonResponse({ conversation, messages: [], actions: [] })
        )
      if (route === `GET /api/v1/rag/conversations/${conversationID}/runs`)
        return Promise.resolve(jsonResponse(null))
      if (route === 'GET /api/v1/skills')
        return Promise.resolve(jsonResponse({ skills: [] }))
      return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
    })
  )
}

it('opens the chat with the added selection kept for the question and the box focused', async () => {
  stubChatWithOneConversation()
  const screen = await mountWithEditor()
  await userEvent.click(screen.getByRole('button', { name: 'Add selection' }))
  await expect.element(screen.getByText('Hello · L3')).toBeVisible()
  await expect
    .element(screen.getByRole('textbox', { name: 'Ask a question' }))
    .toHaveFocus()
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove file Hello · L3' })
  )
  expect(screen.getByText('Hello · L3').elements()).toHaveLength(0)
})

it('opens the chat without touching what is kept when nothing is selected', async () => {
  stubChatWithOneConversation()
  const screen = await mountWithEditor()
  await userEvent.click(screen.getByRole('button', { name: 'Open chat' }))
  await expect
    .element(screen.getByRole('textbox', { name: 'Ask a question' }))
    .toHaveFocus()
  expect(screen.getByText('Hello · L3').elements()).toHaveLength(0)
  await userEvent.click(screen.getByRole('button', { name: 'Open chat' }))
  await expect
    .element(screen.getByRole('textbox', { name: 'Ask a question' }))
    .toBeVisible()
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
