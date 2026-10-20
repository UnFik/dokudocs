import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { testSession } from '@/test-utils/auth'
import type { DocumentItem } from '@/types/dokudocs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { HtmlDocumentViewer } from './html-document-viewer'

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

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const document: DocumentItem = {
  id: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
  workspaceId: workspaceID,
  title: 'Sales report',
  type: 'html',
  content: '<p>hi</p>',
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

const ticket = {
  url: 'https://usercontent.example.test/content/p/abc',
  expiresAt: '2026-10-12T00:05:00.000Z',
  capabilities: ['theme'],
  canEdit: true,
  canComment: true,
}

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function mount() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <HtmlDocumentViewer
        document={document}
        workspaceID={workspaceID}
        userID='usr-1'
      />
    </QueryClientProvider>
  )
}

it('shows the page in a frame with an opaque origin, under a banner that says where it came from', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: ticket }))
  )
  const screen = await mount()

  await expect
    .poll(() => screen.container.querySelector('iframe'))
    .not.toBeNull()
  const frame = screen.container.querySelector('iframe')!
  expect(frame.getAttribute('src')).toBe(ticket.url)
  // allow-scripts alone: allow-same-origin would let the page act as the application.
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')

  const note = screen.container.querySelector('[role="note"]')!
  expect(note.textContent).toContain('Written through MCP by Ada')
  expect(note.textContent).toContain('sandbox')
})

it('shows no frame when the page cannot be opened', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'not found' }, { status: 404 }))
  )
  const screen = await mount()

  await expect
    .element(screen.getByText('This page cannot be shown.'))
    .toBeInTheDocument()
  expect(screen.container.querySelector('iframe')).toBeNull()
})
