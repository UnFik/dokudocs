import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { testSession } from '@/test-utils/auth'
import type { DocumentItem } from '@/types/dokudocs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import type { CollabStatus } from '../lib/collab-session'
import { RemoteMarkdownDocEditor } from './remote-markdown-doc-editor'

const body = vi.hoisted(() => ({
  onStatus: undefined as ((status: CollabStatus) => void) | undefined,
  host: undefined as HTMLElement | undefined,
  mount: undefined as (() => Promise<unknown>) | undefined,
}))

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

vi.mock('../lib/collaborative-document-body', () => ({
  mountCollaborativeDocumentBody: (
    mount: HTMLElement,
    input: { onStatus: (status: CollabStatus) => void }
  ) => {
    body.host = mount
    body.onStatus = input.onStatus
    return body.mount!()
  },
}))

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const document: DocumentItem = {
  id: 'b1f973dd-b554-4540-95c0-4697726ad6e1',
  workspaceId: workspaceID,
  title: 'Runbook',
  type: 'markdown',
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

const emptyBody = [
  {
    nodeID: 'root',
    parentID: null,
    siblingOrder: 0,
    type: 'document',
    content: '',
    attributes: {},
  },
]

// A session whose editor and provider methods are harmless no-ops.
function fakeSession() {
  const quiet = (empty: unknown) => new Proxy({}, { get: () => () => empty })
  const editor = new Proxy(
    {},
    {
      get: (_target, name) => () =>
        name === 'getBody'
          ? emptyBody
          : name === 'getSuggestionCards'
            ? []
            : undefined,
    }
  )
  return { editor, session: quiet(undefined), destroy: () => {} }
}

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {}))
  )
  body.onStatus = undefined
  body.host = undefined
  body.mount = async () => fakeSession()
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

async function renderEditor(offline = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RemoteMarkdownDocEditor
        document={document}
        workspaceID={workspaceID}
        userID='usr-1'
        offline={offline}
      />
    </QueryClientProvider>
  )
}

it('covers the body with a skeleton until the document is synced', async () => {
  const screen = await renderEditor()

  const busy = screen.container.querySelector('[aria-busy="true"]')
  expect(busy).not.toBeNull()
  await expect
    .element(screen.getByText('Loading document content'))
    .toBeInTheDocument()
  // The toolbar's status line stays the only status region.
  expect(screen.container.querySelectorAll('[role="status"]')).toHaveLength(1)

  await vi.waitFor(() => expect(body.onStatus).toBeDefined())
  body.onStatus!('ready')

  await expect
    .poll(() => screen.container.querySelector('[aria-busy="true"]'))
    .toBeNull()
  await expect.element(screen.getByRole('status')).toHaveTextContent('Synced')
})

it('opens the local copy straight away when offline instead of waiting behind a skeleton', async () => {
  const screen = await renderEditor(true)

  expect(screen.container.querySelector('[aria-busy="true"]')).toBeNull()
})

it('drops the skeleton and shows the error when the session cannot start', async () => {
  body.mount = async () => {
    throw new Error('Collaboration failed')
  }
  const screen = await renderEditor()

  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Collaboration failed')
  expect(screen.container.querySelector('[aria-busy="true"]')).toBeNull()
})

it('keeps the class the editor plugins put on the body host once the document is synced', async () => {
  const screen = await renderEditor()
  await vi.waitFor(() => expect(body.host).toBeDefined())
  // The block handle, the + button and the table controls position themselves against
  // this element, so it has to stay `position: relative`; without it they sit against
  // the page and stretch it to the height of the document.
  body.host!.classList.add('dd-host')
  body.onStatus!('ready')

  await expect
    .poll(() => screen.container.querySelector('[aria-busy="true"]'))
    .toBeNull()
  expect(body.host!.classList.contains('dd-host')).toBe(true)
})
