import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { listDocuments } from '@/lib/domain-api'
import { DocCard } from './doc-card'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const document = {
  id: documentId,
  workspaceId,
  title: 'Invoice flow',
  type: 'markdown',
  content: '# Invoice flow',
  authorId: testSession().user.id,
  author: {
    id: testSession().user.id,
    name: 'Test User',
    email: 'user@example.com',
    avatar: '',
  },
  tags: [],
  isDraft: false,
  visibility: 'workspace',
  isStarred: false,
  isShared: false,
  categories: [],
  createdAt: '2026-10-08T00:00:00Z',
  updatedAt: '2026-10-08T00:00:00Z',
}

function CardUnderTest() {
  const { data = [] } = useQuery({
    queryKey: ['documents', workspaceId],
    queryFn: () => listDocuments(workspaceId),
  })
  return data[0] && <DocCard document={data[0]} />
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CardUnderTest />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  useDokudocsStore.setState({ documents: [] })
  success.mockReset()
  error.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

describe('Starring a document from its card', () => {
  it('stars and unstars it on the server and shows it on the card', async () => {
    let starred = false
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        starred = !starred
        return Promise.resolve(jsonResponse({ isStarred: starred }))
      }
      return Promise.resolve(
        jsonResponse([{ ...document, isStarred: starred }])
      )
    })
    vi.stubGlobal('fetch', fetch)
    const screen = await renderCard()

    await screen.getByTitle('Star Document', { exact: true }).click()
    await expect
      .element(screen.getByTitle('Unstar Document', { exact: true }))
      .toBeVisible()
    await screen.getByTitle('Unstar Document', { exact: true }).click()
    await expect
      .element(screen.getByTitle('Star Document', { exact: true }))
      .toBeVisible()

    const requests = fetch.mock.calls.filter(
      ([, init]) => init?.method === 'POST'
    )
    expect(requests).toHaveLength(2)
    for (const [url, init] of requests) {
      expect(new URL(String(url)).pathname).toBe(
        `/api/v1/documents/${documentId}/star`
      )
      expect(new Headers(init?.headers).get('X-Workspace-Id')).toBe(workspaceId)
    }
    expect(success).toHaveBeenCalledWith('Starred "Invoice flow"')
    expect(success).toHaveBeenCalledWith('Unstarred "Invoice flow"')
  })

  it('keeps the star as it was, and says why, when the server refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? jsonResponse({ title: 'Star failed' }, 500)
            : jsonResponse([document])
        )
      )
    )
    const screen = await renderCard()

    await screen.getByTitle('Star Document', { exact: true }).click()
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Star failed'))
    await expect
      .element(screen.getByTitle('Star Document', { exact: true }))
      .toBeVisible()
    expect(success).not.toHaveBeenCalled()
  })
})
