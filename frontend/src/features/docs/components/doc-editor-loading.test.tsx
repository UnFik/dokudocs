import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { DocEditor } from './doc-editor'

const docId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const workspaces = vi.hoisted(() => ({
  state: {
    activeWorkspaceId: undefined as string | undefined,
    isLoading: true,
  },
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useParams: () => ({ docId }),
    useSearch: () => ({ workspaceId: undefined, nodeId: undefined }),
    useNavigate: () => vi.fn(),
  }
})

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useWorkspaces: () => workspaces.state,
}))

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {}))
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

async function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <DocEditor />
    </QueryClientProvider>
  )
}

function expectBusySkeleton(container: Element) {
  const busy = container.querySelector('[aria-busy="true"]')
  expect(busy).not.toBeNull()
  expect(
    busy!.querySelectorAll('[data-slot="skeleton"]').length
  ).toBeGreaterThan(2)
  // The toolbar's "Synced" is the only status region; specs find it by role.
  expect(container.querySelector('[role="status"]')).toBeNull()
}

it('shows a busy skeleton while the workspaces load', async () => {
  workspaces.state = { activeWorkspaceId: undefined, isLoading: true }
  const screen = await renderEditor()

  expectBusySkeleton(screen.container)
  await expect.element(screen.getByText('Loading document')).toBeInTheDocument()
})

it('shows a busy skeleton while the document request is pending', async () => {
  workspaces.state = { activeWorkspaceId: workspaceId, isLoading: false }
  const screen = await renderEditor()

  expectBusySkeleton(screen.container)
  await expect.element(screen.getByText('Loading document')).toBeInTheDocument()
})
