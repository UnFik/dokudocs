import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { sseFrame, sseResponse } from '@/test-utils/sse'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import type { RAGConversationHistory } from '@/lib/domain-api'
import { rememberOpenedPublicLink } from '@/lib/public-link-session'
import { SidebarProvider } from '@/components/ui/sidebar'
import { RAGChatPage } from './rag-chat-page'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const conversationID = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const runID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
const nodeID = 'd2bd52f1-e274-4119-af61-737b0e8c80a9'
const conversation: RAGConversationHistory['conversation'] = {
  id: conversationID,
  workspaceId: workspaceID,
  creatorId: testSession().user.id,
  title: 'Recovery policy',
  unread: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}
const history: RAGConversationHistory = {
  conversation,
  messages: [
    {
      id: 'ef27eac4-3eea-4ced-b4fa-e7f6b1c81ed4',
      conversationId: conversationID,
      role: 'user',
      content: 'What is the recovery policy?',
      citations: [],
      coveragePartial: false,
      sourcesMayBeIncomplete: false,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'ff27eac4-3eea-4ced-b4fa-e7f6b1c81ed4',
      conversationId: conversationID,
      role: 'assistant',
      content: 'Restart the service after a failed health check.',
      citations: [
        {
          documentId: documentID,
          documentTitle: 'Operations runbook',
          projectName: 'Platform',
          nodeId: nodeID,
          bodyVersion: 4,
          sourceFingerprint: 'source-v4',
          sourceChanged: true,
          quotedText: 'The runbook says restart the service.',
          breadcrumb: 'Recovery',
          ordinal: 0,
        },
      ],
      coveragePartial: true,
      sourcesMayBeIncomplete: true,
      createdAt: '2026-10-01T00:00:01.000Z',
    },
  ],
}
const conflictingHistory = {
  ...history,
  messages: [
    history.messages[0]!,
    {
      ...history.messages[1]!,
      content:
        'The documents conflict: the runbook says the service restarts, while the incident guide says it never restarts.',
      citations: [
        history.messages[1]!.citations![0]!,
        {
          ...history.messages[1]!.citations![0]!,
          documentId: '5dc66b49-f0e7-4eab-8718-3bc2080206b8',
          documentTitle: 'Incident guide',
          nodeId: '967e94bf-015e-4c38-9c7e-3412831df8e0',
          quotedText: 'The service never restarts after a failed health check.',
          ordinal: 1,
        },
      ],
    },
  ],
}

function setup(
  hasWorkspace = true,
  chatHistory: RAGConversationHistory = history,
  respond?: (
    url: URL
  ) => RAGConversationHistory & { nextCursor?: string | null }
) {
  useAuthStore.getState().auth.setSession(testSession())
  useDokudocsStore.setState({ activeOrgId: workspaceID })
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/workspaces')
      return jsonResponse(
        hasWorkspace
          ? [
              {
                id: workspaceID,
                name: 'Engineering',
                plan: 'Free',
                role: 'member',
              },
            ]
          : []
      )
    if (url.pathname === '/api/v1/rag/conversations' && init?.method === 'POST')
      return jsonResponse(conversation, 201)
    if (url.pathname === '/api/v1/rag/conversations')
      return jsonResponse([conversation])
    if (url.pathname === '/api/v1/rag/document-search')
      return jsonResponse([
        {
          id: documentID,
          title: 'Operations runbook',
          type: 'markdown',
          projectName: 'Platform',
        },
      ])
    if (url.pathname === `/api/v1/rag/conversations/${conversationID}/runs`)
      return init?.method === 'POST'
        ? jsonResponse(
            {
              id: runID,
              kind: 'chat',
              status: 'running',
              draft: '',
              sequence: 0,
            },
            202
          )
        : jsonResponse(null)
    if (url.pathname === `/api/v1/ai/runs/${runID}/events`)
      return sseResponse([sseFrame(1, 'completed', { id: runID })])
    if (
      url.pathname === `/api/v1/rag/conversations/${conversationID}` &&
      init?.method === 'DELETE'
    )
      return new Response(null, { status: 204 })
    if (url.pathname === `/api/v1/rag/conversations/${conversationID}`)
      return jsonResponse(respond ? respond(url) : chatHistory)
    throw new Error(`Unexpected request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetch)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return { fetch, queryClient }
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  useAuthStore.getState().auth.reset()
  useDokudocsStore.setState({ activeOrgId: 'org-1' })
})

it('shows persisted coverage and changed-source status and sends a workspace question', async () => {
  rememberOpenedPublicLink('opened-public-token')
  const { fetch, queryClient } = setup()
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RAGChatPage />
      </SidebarProvider>
    </QueryClientProvider>
  )

  await expect
    .element(
      screen.getByText('This source changed after the answer was created.')
    )
    .toBeInTheDocument()
  await expect
    .element(screen.getByText(/Some readable documents have stale indexes/))
    .toBeInTheDocument()
  await expect
    .element(screen.getByText(/Some document blocks could not be indexed/))
    .toBeInTheDocument()

  const sourceLink = screen.getByRole('link', { name: 'Open block' })
  await expect
    .element(sourceLink)
    .toHaveAttribute(
      'href',
      `/docs/${documentID}?workspaceId=${workspaceID}&nodeId=${nodeID}#node-${nodeID}`
    )

  const question = screen.getByRole('textbox', { name: 'Ask a question' })
  await userEvent.fill(question, 'How does recovery work?')
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await vi.waitFor(() => {
    const ask = fetch.mock.calls.find(
      ([input, init]) =>
        new URL(String(input)).pathname.endsWith('/runs') &&
        init?.method === 'POST'
    )
    expect(ask).toBeDefined()
    expect(new Headers(ask?.[1]?.headers).get('X-Workspace-Id')).toBe(
      workspaceID
    )
    expect(new Headers(ask?.[1]?.headers).get('Idempotency-Key')).toBeTruthy()
    expect(JSON.parse(String(ask?.[1]?.body))).toMatchObject({
      question: 'How does recovery work?',
      language: 'en',
      publicLinkTokens: ['opened-public-token'],
    })
  })
})

it('keeps a former workspace conversation readable and read-only', async () => {
  const { queryClient } = setup(false)
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RAGChatPage />
      </SidebarProvider>
    </QueryClientProvider>
  )

  await expect
    .element(
      screen.getByText(
        'This chat is read-only because you no longer belong to its workspace.'
      )
    )
    .toBeInTheDocument()
  await expect
    .element(
      screen.getByText('Restart the service after a failed health check.')
    )
    .toBeInTheDocument()
  expect(document.querySelector('textarea')).toBeNull()
})

it('shows a disagreement and both source citations in the saved answer', async () => {
  const { queryClient } = setup(true, conflictingHistory)
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RAGChatPage />
      </SidebarProvider>
    </QueryClientProvider>
  )

  await expect
    .element(screen.getByText(/The documents conflict:/))
    .toBeInTheDocument()
  await expect
    .element(screen.getByText('The runbook says restart the service.'))
    .toBeInTheDocument()
  await expect
    .element(
      screen.getByText(
        'The service never restarts after a failed health check.'
      )
    )
    .toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open block' }).all()).toHaveLength(2)
})

const deletes = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')

it('asks before deleting a chat and keeps it when cancelled', async () => {
  const { fetch, queryClient } = setup()
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RAGChatPage />
      </SidebarProvider>
    </QueryClientProvider>
  )

  // Keyboard focus on the row shows its actions, as hovering does.
  const row = screen.getByRole('button', { name: /Recovery policy/ }).first()
  await expect.element(row).toBeVisible()
  row.element().focus()
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete chat' }).first()
  )
  await expect
    .element(screen.getByRole('alertdialog', { name: 'Delete this chat?' }))
    .toBeInTheDocument()
  await expect
    .element(screen.getByText(/cannot be restored/))
    .toBeInTheDocument()
  expect(deletes(fetch)).toHaveLength(0)

  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
  expect(deletes(fetch)).toHaveLength(0)
})

it('deletes the chat once the dialog is confirmed', async () => {
  const { fetch, queryClient } = setup()
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RAGChatPage />
      </SidebarProvider>
    </QueryClientProvider>
  )

  // Keyboard focus on the row shows its actions, as hovering does.
  const row = screen.getByRole('button', { name: /Recovery policy/ }).first()
  await expect.element(row).toBeVisible()
  row.element().focus()
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete chat' }).first()
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Delete', exact: true })
  )
  await vi.waitFor(() => expect(deletes(fetch)).toHaveLength(1))
  expect(String(deletes(fetch)[0]![0])).toContain(
    `/rag/conversations/${conversationID}`
  )
  await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
})

const longMessages = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i
    return {
      ...history.messages[0]!,
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      role: n % 2 === 0 ? ('assistant' as const) : ('user' as const),
      content: `Message ${n}\nline two of ${n}\nline three of ${n}`,
      citations: [],
      coveragePartial: false,
      sourcesMayBeIncomplete: false,
    }
  })

function pagedHistory(url: URL) {
  const before = url.searchParams.get('before')
  if (before === 'older-1')
    return { ...history, messages: longMessages(11, 40), nextCursor: 'older-2' }
  if (before === 'older-2')
    return { ...history, messages: longMessages(1, 10), nextCursor: null }
  return { ...history, messages: longMessages(41, 70), nextCursor: 'older-1' }
}

const askedBefore = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls
    .map(([input]) => new URL(String(input)))
    .filter(
      (url) => url.pathname === `/api/v1/rag/conversations/${conversationID}`
    )
    .map((url) => url.searchParams.get('before'))

it('opens at the newest messages and loads older ones on the way up', async () => {
  const { fetch, queryClient } = setup(true, history, pagedHistory)
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <div
          style={{ height: '640px', display: 'flex', flexDirection: 'column' }}
        >
          <RAGChatPage />
        </div>
      </SidebarProvider>
    </QueryClientProvider>
  )

  await expect.element(screen.getByText('Message 70')).toBeVisible()
  expect(screen.getByText('Message 40').elements()).toHaveLength(0)
  const log = screen.getByRole('log', { name: 'Messages' }).element()
  await vi.waitFor(() =>
    expect(log.scrollHeight - log.scrollTop - log.clientHeight).toBeLessThan(4)
  )
  expect(askedBefore(fetch)).toEqual([null])

  const anchor = screen.getByText('Message 41').element()
  log.scrollTop = 0
  const readingAt = () =>
    anchor.getBoundingClientRect().top - log.getBoundingClientRect().top
  const before = readingAt()
  await expect.element(screen.getByText('Message 40')).toBeInTheDocument()
  expect(askedBefore(fetch)).toEqual([null, 'older-1'])
  // The message the User was reading stays where it was while older ones appear above it.
  await vi.waitFor(() => expect(log.scrollTop).toBeGreaterThan(100))
  expect(Math.abs(readingAt() - before)).toBeLessThan(3)

  log.scrollTop = 0
  await expect.element(screen.getByText(/^Message 1\s/)).toBeInTheDocument()
  expect(askedBefore(fetch)).toEqual([null, 'older-1', 'older-2'])
  expect(
    screen.getByRole('button', { name: 'Load earlier messages' }).elements()
  ).toHaveLength(0)
})

it('lets a keyboard User load earlier messages with a button', async () => {
  const { queryClient } = setup(true, history, pagedHistory)
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <div
          style={{ height: '640px', display: 'flex', flexDirection: 'column' }}
        >
          <RAGChatPage />
        </div>
      </SidebarProvider>
    </QueryClientProvider>
  )
  await expect.element(screen.getByText('Message 70')).toBeVisible()
  // A DOM click: Playwright would scroll the button into view first, which loads the page by itself.
  const button = screen
    .getByRole('button', { name: 'Load earlier messages' })
    .element() as HTMLButtonElement
  button.click()
  await expect.element(screen.getByText('Message 40')).toBeInTheDocument()
})

it('names a document from the workspace of the chat and sends it as a mention', async () => {
  const { fetch, queryClient } = setup()
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RAGChatPage />
      </SidebarProvider>
    </QueryClientProvider>
  )
  const question = screen.getByRole('textbox', { name: 'Ask a question' })
  await userEvent.click(question)
  await userEvent.keyboard('what does @oper')
  await userEvent.click(
    screen.getByRole('button', { name: /Operations runbook/ })
  )
  await userEvent.keyboard('say?{Enter}')
  await vi.waitFor(() => {
    const search = fetch.mock.calls.find(
      ([input]) =>
        new URL(String(input)).pathname === '/api/v1/rag/document-search'
    )
    expect(new Headers(search?.[1]?.headers).get('X-Workspace-Id')).toBe(
      workspaceID
    )
    const ask = fetch.mock.calls.find(
      ([input, init]) =>
        new URL(String(input)).pathname.endsWith('/runs') &&
        init?.method === 'POST'
    )
    expect(JSON.parse(String(ask?.[1]?.body)).question).toBe(
      `what does @[Operations runbook](doc:${documentID}) say?`
    )
  })
})
