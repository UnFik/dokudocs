import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { SidebarProvider } from '@/components/ui/sidebar'
import { StarredNavGroup } from './starred-nav-group'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  useLocation: () => '/dashboard',
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const author = {
  id: testSession().user.id,
  name: 'Test User',
  email: 'user@example.com',
  avatar: '',
}
const base = {
  workspaceId,
  type: 'markdown',
  content: '',
  authorId: author.id,
  author,
  tags: [],
  isDraft: false,
  visibility: 'workspace',
  isShared: false,
  categories: [],
  createdAt: '2026-10-08T00:00:00Z',
  updatedAt: '2026-10-08T00:00:00Z',
}
const starred = {
  ...base,
  id: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
  title: 'Invoice flow',
  isStarred: true,
  starredAt: '2026-10-09T00:00:00Z',
}
const plain = {
  ...base,
  id: 'c2a084ee-c665-4651-a6a1-5798837ae7f2',
  title: 'Runbook',
  isStarred: false,
}

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  // The local store holds neither document: the sidebar must not depend on it.
  useDokudocsStore.setState({ documents: [], projects: [] })
  success.mockReset()
  error.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function stubServer() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) => {
      const path = new URL(String(url)).pathname
      if (path === '/api/v1/workspaces')
        return Promise.resolve(
          jsonResponse([
            {
              id: workspaceId,
              name: 'Engineering',
              plan: 'Free',
              role: 'owner',
            },
          ])
        )
      if (path === '/api/v1/documents')
        return Promise.resolve(jsonResponse([starred, plain]))
      return Promise.resolve(jsonResponse([]))
    })
  )
}

describe('The Starred group of the sidebar', () => {
  it('lists the documents the server says are starred', async () => {
    stubServer()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={client}>
        <SidebarProvider>
          <StarredNavGroup />
        </SidebarProvider>
      </QueryClientProvider>
    )
    await expect.element(screen.getByText('Invoice flow')).toBeVisible()
    await expect.element(screen.getByText('Runbook')).not.toBeInTheDocument()
  })
})
