import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { DraftsPage } from '.'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const userId = 'b4d13df7-76a2-4da5-8817-91d40f832abd'
const originalState = useDokudocsStore.getState()

function draft(id: string, title: string, type: string) {
  return {
    id,
    workspaceId,
    projectId: null,
    title,
    type,
    content: '',
    authorId: userId,
    author: { id: userId, name: 'Ada', email: 'ada@example.com', avatar: '' },
    tags: [],
    isDraft: true,
    visibility: 'workspace',
    isStarred: false,
    isShared: false,
    categories: [],
    createdAt: '2026-10-09T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
  }
}

const starRequests: Headers[] = []

beforeEach(() => {
  starRequests.length = 0
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/workspaces')
        return Promise.resolve(
          jsonResponse([
            { id: workspaceId, name: 'Eng', plan: 'Free', role: 'owner' },
          ])
        )
      if (path === '/api/v1/projects') return Promise.resolve(jsonResponse([]))
      if (path === '/api/v1/documents')
        return Promise.resolve(
          jsonResponse([
            draft(
              'b1f973dd-b554-4540-95c0-4697726ad6e1',
              'Platform canvas',
              'architecture'
            ),
            draft(
              'c2f973dd-b554-4540-95c0-4697726ad6e2',
              'Setup guide',
              'markdown'
            ),
          ])
        )
      if (path.endsWith('/star')) {
        starRequests.push(new Headers(init?.headers))
        return Promise.resolve(jsonResponse({ isStarred: true }))
      }
      throw new Error(`Unexpected request: ${path}`)
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
  useDokudocsStore.setState(originalState)
})

async function renderDrafts() {
  useDokudocsStore.setState({ viewMode: 'list' })
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: DraftsPage,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

it('filters drafts by Architecture and restores the other types with All', async () => {
  const screen = await renderDrafts()
  await expect
    .element(screen.getByText('Platform canvas', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText('Setup guide', { exact: true }))
    .toBeVisible()
  await screen.getByRole('tab', { name: 'Architecture', exact: true }).click()
  await expect
    .element(screen.getByText('Platform canvas', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText('Setup guide', { exact: true }))
    .not.toBeInTheDocument()
  await screen.getByRole('tab', { name: 'All', exact: true }).click()
  await expect
    .element(screen.getByText('Setup guide', { exact: true }))
    .toBeVisible()
})

it('stars a draft with the real workspace id, not a local placeholder', async () => {
  const screen = await renderDrafts()
  await expect
    .element(screen.getByText('Setup guide', { exact: true }))
    .toBeVisible()
  await screen.getByRole('button', { name: 'Star Document' }).first().click()
  await vi.waitFor(() => expect(starRequests).toHaveLength(1))
  expect(starRequests[0].get('X-Workspace-Id')).toBe(workspaceId)
})
