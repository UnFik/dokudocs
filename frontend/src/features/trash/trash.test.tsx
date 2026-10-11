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
import { TrashPage } from '.'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const userId = 'b4d13df7-76a2-4da5-8817-91d40f832abd'
const docId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const { success } = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success, error: vi.fn() } }))

const author = { id: userId, name: 'Ada', email: 'ada@example.com', avatar: '' }
const trashItem = {
  id: 'c2f973dd-b554-4540-95c0-4697726ad6e2',
  docId,
  deletedAt: '2026-10-10T00:00:00Z',
  deletedBy: author,
  daysRemaining: 29,
  document: {
    id: docId,
    workspaceId,
    projectId: null,
    title: 'Old spec',
    type: 'markdown',
    content: '',
    authorId: userId,
    author,
    tags: null,
    categories: null,
    isDraft: true,
    visibility: '',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
  },
}

const originalState = useDokudocsStore.getState()
const calls: { path: string; method: string; workspace: string | null }[] = []
let items: unknown[] = []

beforeEach(() => {
  calls.length = 0
  items = [trashItem]
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      const method = init?.method ?? 'GET'
      if (path === '/api/v1/workspaces')
        return Promise.resolve(
          jsonResponse([
            { id: workspaceId, name: 'Eng', plan: 'Free', role: 'owner' },
          ])
        )
      calls.push({
        path,
        method,
        workspace: new Headers(init?.headers).get('X-Workspace-Id'),
      })
      if (path === '/api/v1/trash' && method === 'GET')
        return Promise.resolve(jsonResponse(items))
      items = []
      return Promise.resolve(jsonResponse({ status: 'ok' }))
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
  useDokudocsStore.setState(originalState)
})

async function renderTrash() {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: TrashPage,
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

it('lists server trash and restores a document in the real workspace', async () => {
  const screen = await renderTrash()
  await expect.element(screen.getByText('Old spec')).toBeVisible()
  await screen.getByTitle('Restore Document').click()
  await vi.waitFor(() =>
    expect(calls).toContainEqual({
      path: `/api/v1/documents/${docId}/restore`,
      method: 'POST',
      workspace: workspaceId,
    })
  )
  await expect.element(screen.getByText('Old spec')).not.toBeInTheDocument()
})

it('says so when the trash cannot be loaded instead of showing it empty', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        new URL(String(input)).pathname === '/api/v1/workspaces'
          ? jsonResponse([
              { id: workspaceId, name: 'Eng', plan: 'Free', role: 'owner' },
            ])
          : jsonResponse({ title: 'Trash unavailable' }, 500)
      )
    )
  )
  const screen = await renderTrash()
  await expect
    .element(screen.getByText('Could not load the trash'))
    .toBeVisible()
  await expect
    .element(screen.getByText('Trash is empty'))
    .not.toBeInTheDocument()
})

it('empties the server trash after confirmation', async () => {
  const screen = await renderTrash()
  await expect.element(screen.getByText('Old spec')).toBeVisible()
  await screen.getByRole('button', { name: 'Empty Trash' }).click()
  await screen.getByRole('button', { name: 'Empty Trash' }).last().click()
  await vi.waitFor(() =>
    expect(calls).toContainEqual({
      path: '/api/v1/trash',
      method: 'DELETE',
      workspace: workspaceId,
    })
  )
  expect(success).toHaveBeenCalledWith('Trash emptied successfully')
})
