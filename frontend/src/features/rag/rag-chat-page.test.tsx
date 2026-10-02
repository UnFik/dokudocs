import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
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
const nodeID = 'd2bd52f1-e274-4119-af61-737b0e8c80a9'
const conversation: RAGConversationHistory['conversation'] = {
  id: conversationID,
  workspaceId: workspaceID,
  creatorId: testSession().user.id,
  title: 'Recovery policy',
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
  chatHistory: RAGConversationHistory = history
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
    if (url.pathname === `/api/v1/rag/conversations/${conversationID}/messages`)
      return jsonResponse({
        conversationId: conversationID,
        text: 'Restart the service after a failed health check.',
        citations: chatHistory.messages[1]?.citations ?? [],
        coveragePartial: true,
        sourcesMayBeIncomplete: true,
      })
    if (url.pathname === `/api/v1/rag/conversations/${conversationID}`)
      return jsonResponse(chatHistory)
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
        new URL(String(input)).pathname.endsWith('/messages') &&
        init?.method === 'POST'
    )
    expect(ask).toBeDefined()
    expect(new Headers(ask?.[1]?.headers).get('X-Workspace-Id')).toBe(
      workspaceID
    )
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
