import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { controlledStream } from '@/test-utils/sse'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { DocumentChatPanel } from './document-chat-panel'
import { registerEditorSource, requestFix } from './editor-source'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const runID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
const conversationID = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const conversation = {
  id: conversationID,
  workspaceId: workspaceID,
  documentId: documentID,
  title: 'Schema',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}
const error = 'Invalid column definition or missing type'

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

const stops: Array<() => void> = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  localStorage.clear()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

async function mount() {
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
    if (route === 'GET /api/v1/skills')
      return Promise.resolve(jsonResponse({ skills: [] }))
    return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
  })
  vi.stubGlobal('fetch', fetch)
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
        title='Schema'
      />
    </QueryClientProvider>
  )
  return { screen, fetch }
}

const sentRun = (fetch: Awaited<ReturnType<typeof mount>>['fetch']) => {
  const [, init] = fetch.mock.calls.find(
    ([url, init]) =>
      key(url, init) === `POST /api/v1/rag/conversations/${conversationID}/runs`
  )!
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

async function ask(screen: Awaited<ReturnType<typeof mount>>['screen']) {
  await userEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await userEvent.fill(
    screen.getByRole('textbox', { name: 'Ask a question' }),
    'read the editor error'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
}

it('sends what the open DBML editor shows along with the question', async () => {
  stops.push(
    registerEditorSource(documentID, () => ({
      kind: 'dbml',
      source: 'Table t {\n  id\n}',
      cursor: { line: 2, column: 3 },
      markers: [
        {
          startLineNumber: 2,
          startColumn: 3,
          endLineNumber: 2,
          endColumn: 5,
          message: error,
          severity: 8,
        },
      ],
    }))
  )
  const { screen, fetch } = await mount()
  await ask(screen)
  await vi.waitFor(() =>
    expect(sentRun(fetch).question).toBe('read the editor error')
  )
  expect(sentRun(fetch).editorContext).toEqual({
    documentId: documentID,
    kind: 'dbml',
    cursor: { line: 2, column: 3 },
    diagnostics: [
      {
        line: 2,
        column: 3,
        endLine: 2,
        endColumn: 5,
        severity: 'error',
        message: error,
      },
    ],
    excerpt: { fromLine: 1, toLine: 3, text: 'Table t {\n  id\n}' },
  })
})

it('sends no editor state when the document has no source editor open', async () => {
  const { screen, fetch } = await mount()
  await ask(screen)
  await vi.waitFor(() =>
    expect(sentRun(fetch).question).toBe('read the editor error')
  )
  expect(sentRun(fetch)).not.toHaveProperty('editorContext')
})

it('opens the chat with the error as the question when the User asks to fix it', async () => {
  const { screen } = await mount()
  await expect
    .element(screen.getByRole('button', { name: 'Ask AI' }))
    .toBeVisible()
  requestFix(documentID, { line: 3, message: error })
  await expect
    .element(screen.getByRole('textbox', { name: 'Ask a question' }))
    .toHaveValue(`Fix the error at line 3: ${error}`)
})
