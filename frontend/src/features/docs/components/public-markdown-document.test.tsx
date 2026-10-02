import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse } from '@/test-utils/auth'
import { expect, it, vi, afterEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { getOpenedPublicLinkTokens } from '@/lib/public-link-session'
import { PublicMarkdownDocument } from './public-markdown-document'

const shareToken = 'valid-public-link-token'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const nodeID = 'd2bd52f1-e274-4119-af61-737b0e8c80a9'

afterEach(() => {
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

it('keeps a successfully opened public link available to RAG for this tab session', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith(`/public/documents/${shareToken}`))
      return jsonResponse({
        id: documentID,
        workspaceId: '149a8d07-8490-43ed-98fa-ebaa91b05e90',
        projectId: null,
        title: 'Shared Markdown',
        type: 'markdown',
        content: '',
        authorId: documentID,
        author: {
          id: documentID,
          name: 'Document owner',
          email: 'owner@example.invalid',
          avatar: '',
        },
        isDraft: false,
        visibility: 'public_link',
        isShared: true,
        categories: [],
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      })
    if (path.endsWith(`/public/documents/${shareToken}/body`))
      return jsonResponse({
        bodyVersion: 1,
        bodySchemaVersion: 1,
        rootNodeID: documentID,
        nodes: [
          {
            nodeID: documentID,
            parentID: null,
            siblingOrder: 0,
            type: 'document',
            content: '',
            attributes: {},
            version: 1,
          },
          {
            nodeID,
            parentID: documentID,
            siblingOrder: 0,
            type: 'paragraph',
            content: 'Shared source text',
            attributes: {},
            version: 1,
          },
        ],
      })
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <PublicMarkdownDocument shareToken={shareToken} />
    </QueryClientProvider>
  )

  await expect.element(screen.getByText('Shared Markdown')).toBeInTheDocument()
  await expect
    .element(screen.getByText('Shared source text'))
    .toBeInTheDocument()
  expect(getOpenedPublicLinkTokens()).toEqual([shareToken])
})
