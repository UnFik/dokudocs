import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse } from '@/test-utils/auth'
import { expect, it, vi, afterEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { getOpenedPublicLinkTokens } from '@/lib/public-link-session'
import { PublicMarkdownDocument } from './public-markdown-document'

const shareToken = 'valid-public-link-token'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'

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
        content: 'Shared source text',
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

it('draws a shared Architecture document from its canvas, read-only', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      jsonResponse({
        id: documentID,
        workspaceId: '149a8d07-8490-43ed-98fa-ebaa91b05e90',
        projectId: null,
        title: 'Prod',
        type: 'architecture',
        content: 'System "API".',
        contentJSON: {
          version: 1,
          nodes: [
            {
              id: 'api',
              kind: 'system',
              name: 'Order API',
              catalog: 'golang',
              x: 0,
              y: 0,
            },
          ],
          connections: [],
        },
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
    )
  )
  const screen = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PublicMarkdownDocument shareToken={shareToken} />
    </QueryClientProvider>
  )
  await expect
    .element(screen.getByRole('img', { name: 'Architecture diagram of Prod' }))
    .toBeInTheDocument()
  await expect.element(screen.getByText('Order API')).toBeInTheDocument()
})
