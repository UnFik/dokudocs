import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { testSession } from '@/test-utils/auth'
import type { DocumentItem } from '@/types/dokudocs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { RemoteSourceDocEditor } from './remote-source-doc-editor'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({
      children,
      to,
      ...props
    }: {
      children: React.ReactNode
      to: string
      [key: string]: unknown
    }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  }
})

// The room never hands over its text, so the body stays in its loading stage.
vi.mock('../hooks/use-source-session', () => ({
  useSourceSession: () => ({
    text: null,
    awareness: null,
    source: '',
    status: 'connecting',
    access: null,
    presence: [],
    synced: false,
    saveState: 'saved',
    lastSaved: null,
    signalComments: () => {},
    reopen: () => {},
    flushed: async () => true,
  }),
}))

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const document: DocumentItem = {
  id: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
  workspaceId: workspaceID,
  replacementId: 'record-1',
  title: 'Order flow',
  type: 'mermaid',
  content: '',
  projectId: null,
  projectName: '',
  categories: [],
  category: '',
  orgId: workspaceID,
  author: { id: 'usr-1', name: 'Ada', email: 'ada@example.com', avatar: '' },
  isDraft: false,
  isStarred: false,
  isShared: false,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
}

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

it('holds the diagram area with a busy skeleton until the room hands over its text', async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <RemoteSourceDocEditor
        document={document}
        workspaceID={workspaceID}
        userID='usr-1'
      />
    </QueryClientProvider>
  )

  const busy = screen.container.querySelector('[aria-busy="true"]')
  expect(busy).not.toBeNull()
  expect(
    busy!.querySelectorAll('[data-slot="skeleton"]').length
  ).toBeGreaterThan(2)
  await expect.element(screen.getByText('Loading diagram')).toBeInTheDocument()
})
