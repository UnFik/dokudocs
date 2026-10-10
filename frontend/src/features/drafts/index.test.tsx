import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { DocumentItem } from '@/types/dokudocs'
import { afterEach, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { DraftsPage } from '.'

const originalState = useDokudocsStore.getState()
afterEach(() => useDokudocsStore.setState(originalState))

it('filters drafts by Architecture and restores the other types with All', async () => {
  const base = {
    orgId: 'org-1',
    content: '',
    projectId: null,
    isDraft: true,
    author: { id: 'user-1', name: 'Ada', email: 'ada@example.com', avatar: '' },
    isStarred: false,
    isShared: false,
    createdAt: '2026-10-09T00:00:00Z',
    updatedAt: '2026-10-09T00:00:00Z',
  }
  const documents: DocumentItem[] = [
    { ...base, id: 'canvas-1', title: 'Platform canvas', type: 'architecture' },
    { ...base, id: 'guide-1', title: 'Setup guide', type: 'markdown' },
  ]
  useDokudocsStore.setState({
    documents,
    activeOrgId: 'org-1',
    projects: [],
    viewMode: 'list',
  })
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
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
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
