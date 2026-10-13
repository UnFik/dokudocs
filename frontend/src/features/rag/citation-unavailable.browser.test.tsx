import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { getRAGConversation } from '@/lib/domain-api'
import { ChatMessages } from './chat-thread'

const conversationID = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const readable = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const hidden = 'c1f973dd-b554-4540-95c0-4697726ad6e1'
const node = 'd2bd52f1-e274-4119-af61-737b0e8c80a9'

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

// The shape the server sends: a citation the reader cannot open has no title, quote or version.
const serverHistory = {
  conversation: {
    id: conversationID,
    workspaceId: workspaceID,
    title: 'Pay',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  },
  messages: [
    {
      id: '2f27eac4-3eea-4ced-b4fa-e7f6b1c81ed4',
      conversationId: conversationID,
      role: 'assistant',
      content: 'Band 3 starts at 5000.',
      citations: [
        {
          documentId: readable,
          documentTitle: 'Handbook',
          nodeId: node,
          bodyVersion: 1,
          quotedText: 'Pay is monthly.',
          breadcrumb: 'Pay',
          ordinal: 0,
        },
        {
          documentId: hidden,
          documentTitle: '',
          nodeId: node,
          bodyVersion: 0,
          quotedText: '',
          breadcrumb: '',
          ordinal: 1,
          unavailable: true,
        },
      ],
      createdAt: '2026-10-01T00:00:01Z',
    },
  ],
  actions: [],
}

it('shows a source the reader lost access to as unavailable, with no link or quote', async () => {
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(serverHistory)))
  )
  // Read through the real client, so the shape the server sends has to parse.
  const history = await getRAGConversation(conversationID)
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatMessages
        messages={history.messages}
        workspaceID={workspaceID}
        conversationID={conversationID}
        queryKey={['rag-conversation']}
      />
    </QueryClientProvider>
  )
  await expect.element(screen.getByText('Handbook')).toBeVisible()
  await expect.element(screen.getByText('Document not available')).toBeVisible()
  await expect
    .element(screen.getByText(/You no longer have access to this source/))
    .toBeVisible()
  // Only the readable source offers a way to open it.
  expect(screen.getByRole('link', { name: 'Open block' }).all()).toHaveLength(1)
})
