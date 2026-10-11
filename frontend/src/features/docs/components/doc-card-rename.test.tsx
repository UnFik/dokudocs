import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { jsonResponse, testSession } from '@/test-utils/auth'
import type { DocumentItem } from '@/types/dokudocs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { DocCard } from './doc-card'
import { DocListRow } from './doc-list-row'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const document = {
  id: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
  orgId: workspaceId,
  workspaceId,
  title: 'Old spec',
  type: 'markdown',
  content: '',
  isDraft: true,
  projectId: null,
  author: { id: 'u', name: 'Ada', email: 'a@b.c', avatar: '' },
  isStarred: false,
  isShared: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-09T00:00:00Z',
} as DocumentItem

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/workspaces')
        return Promise.resolve(
          jsonResponse([
            { id: workspaceId, name: 'Eng', plan: 'Free', role: 'owner' },
          ])
        )
      return Promise.resolve(jsonResponse([]))
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

async function renderItem(component: () => React.ReactElement) {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/',
    component,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

// A menu item that opens a dialog must leave the dialog's field focused, or
// the first thing the person types goes nowhere.
describe.each([
  ['card', () => <DocCard document={document} />],
  ['row', () => <DocListRow document={document} />],
])('rename from the %s menu', (_, component) => {
  it('takes what is typed from the right-click menu', async () => {
    const screen = await renderItem(component)
    await screen
      .getByText('Old spec', { exact: true })
      .first()
      .click({ button: 'right' })
    await screen.getByRole('menuitem', { name: 'Rename' }).click()
    const input = screen.getByLabelText('Document Title')
    await input.fill('New name')
    await expect.element(input).toHaveValue('New name')
  })

  it('takes what is typed from the more-actions menu', async () => {
    const screen = await renderItem(component)
    await screen.getByRole('button', { name: 'Document actions' }).click()
    await screen.getByRole('menuitem', { name: 'Rename' }).click()
    const input = screen.getByLabelText('Document Title')
    await input.fill('New name')
    await expect.element(input).toHaveValue('New name')
  })
})
