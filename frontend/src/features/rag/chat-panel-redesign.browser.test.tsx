import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { DocumentChatPanel } from './document-chat-panel'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const idA = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const idB = '75b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const hour = 3_600_000

type Chat = {
  id: string
  workspaceId: string
  documentId: string
  title: string
  unread: boolean
  pinnedAt?: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

const chat = (id: string, title: string, extra: Partial<Chat> = {}): Chat => ({
  id,
  workspaceId: workspaceID,
  documentId: documentID,
  title,
  unread: false,
  createdAt: ago(48 * hour),
  updatedAt: ago(2 * hour),
  ...extra,
})

const key = (url: string, init: RequestInit = {}) =>
  `${init.method ?? 'GET'} ${new URL(url).pathname}`

type Calls = { route: string; body: unknown }[]

async function setup(
  options: {
    chats?: Chat[]
    usage?: { used: number; limit: number }
    skills?: { id: string; name: string; description: string }[]
  } = {}
) {
  const chats = options.chats ?? [
    chat(idA, 'Deploy checklist', { unread: true }),
    chat(idB, 'Schema questions', { updatedAt: ago(3 * 24 * hour) }),
  ]
  const calls: Calls = []
  const usage = options.usage ?? { used: 1_200_000, limit: 3_000_000 }
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const route = key(url, init)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ route, body })
    if (route === `GET /api/v1/rag/documents/${documentID}/conversations`)
      return Promise.resolve(jsonResponse(chats))
    if (route === 'GET /api/v1/rag/usage')
      return Promise.resolve(
        jsonResponse({ ...usage, resetsAt: '2026-11-01T00:00:00Z' })
      )
    if (route === 'GET /api/v1/skills')
      return Promise.resolve(jsonResponse({ skills: options.skills ?? [] }))
    const history = /^GET \/api\/v1\/rag\/conversations\/([^/]+)$/.exec(route)
    if (history) {
      const found = chats.find((item) => item.id === history[1])
      return Promise.resolve(
        jsonResponse({ conversation: found, messages: [], actions: [] })
      )
    }
    if (/^GET \/api\/v1\/rag\/conversations\/[^/]+\/runs$/.test(route))
      return Promise.resolve(jsonResponse(null))
    if (/^POST \/api\/v1\/rag\/conversations\/[^/]+\/read$/.test(route))
      return Promise.resolve(new Response(null, { status: 204 }))
    const patch = /^PATCH \/api\/v1\/rag\/conversations\/([^/]+)$/.exec(route)
    if (patch) {
      const found = chats.find((item) => item.id === patch[1])!
      return Promise.resolve(jsonResponse({ ...found, ...body }))
    }
    if (route === 'POST /api/v1/rag/conversations')
      return Promise.resolve(
        jsonResponse(chat('85b7593c-3a2d-45a4-a47d-47e8a1c8136b', ''), 201)
      )
    return Promise.resolve(jsonResponse({ title: 'not found' }, 404))
  })
  vi.stubGlobal('fetch', fetch)
  useAuthStore.getState().auth.setSession(testSession())
  const screen = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DocumentChatPanel
        documentID={documentID}
        workspaceID={workspaceID}
        title='Spec'
      />
    </QueryClientProvider>
  )
  return { screen, calls }
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

it('puts the whole header on one row and keeps the global options in the menu', async () => {
  const { screen } = await setup()
  await userEvent.click(screen.getByRole('button', { name: /Ask AI/ }))

  await expect
    .element(screen.getByRole('button', { name: /Chat history/ }))
    .toHaveTextContent('Deploy checklist')
  await expect
    .element(screen.getByRole('heading', { name: 'Ask about this document' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'New chat' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Close' }))
    .toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Chat options' }))
  await expect
    .element(screen.getByRole('menuitem', { name: 'Download conversation' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('menuitem', { name: 'Settings' }))
    .toHaveAttribute('href', '/settings/ai')
  const sound = screen.getByRole('menuitemcheckbox', {
    name: 'Play notification sound when completed',
  })
  await expect.element(sound).toHaveAttribute('aria-checked', 'false')
  await userEvent.click(sound)
  expect(
    JSON.parse(localStorage.getItem('dokudocs.chat-preferences')!)
  ).toEqual({ sound: true, browser: false })
})

it('lists the chats on the same panel with their unread state and age', async () => {
  const { screen, calls } = await setup()
  await userEvent.click(screen.getByRole('button', { name: /Ask AI/ }))
  await userEvent.click(screen.getByRole('button', { name: /Chat history/ }))

  const rows = screen.getByRole('list', { name: 'Chats' })
  await expect.element(rows.getByText('Deploy checklist')).toBeVisible()
  await expect.element(rows.getByText('Schema questions')).toBeVisible()
  await expect.element(rows.getByText('2h')).toBeVisible()
  await expect.element(rows.getByText('3d')).toBeVisible()
  await expect.element(rows.getByText('Unread')).toBeVisible()

  await userEvent.click(rows.getByText('Schema questions'))
  await expect
    .element(screen.getByRole('button', { name: /Chat history/ }))
    .toHaveTextContent('Schema questions')
  expect(calls.map((c) => c.route)).toContain(
    `GET /api/v1/rag/conversations/${idB}`
  )
})

it('renames, pins and archives a chat from its row', async () => {
  const { screen, calls } = await setup()
  await userEvent.click(screen.getByRole('button', { name: /Ask AI/ }))
  await userEvent.click(screen.getByRole('button', { name: /Chat history/ }))
  const patches = () =>
    calls.filter((c) => c.route.startsWith('PATCH')).map((c) => c.body)

  const list = screen.getByRole('list', { name: 'Chats' })
  await userEvent.hover(list.getByText('Schema questions'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Pin Schema questions' })
  )
  await vi.waitFor(() => expect(patches()).toContainEqual({ pinned: true }))

  await userEvent.hover(list.getByText('Schema questions'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Rename Schema questions' })
  )
  const input = screen.getByRole('textbox', { name: 'Chat name' })
  await userEvent.fill(input, 'Release plan')
  await userEvent.keyboard('{Enter}')
  await vi.waitFor(() =>
    expect(patches()).toContainEqual({ title: 'Release plan' })
  )

  await userEvent.hover(list.getByText('Deploy checklist'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Archive Deploy checklist' })
  )
  await vi.waitFor(() => expect(patches()).toContainEqual({ archived: true }))
})

it('starts a new chat from the plus in the header', async () => {
  const { screen, calls } = await setup()
  await userEvent.click(screen.getByRole('button', { name: /Ask AI/ }))
  await userEvent.click(screen.getByRole('button', { name: 'New chat' }))
  await vi.waitFor(() =>
    expect(
      calls.find((c) => c.route === 'POST /api/v1/rag/conversations')?.body
    ).toEqual({ documentId: documentID })
  )
})

it('asks without a visible label, sends with an icon and offers skills from the plus', async () => {
  const { screen } = await setup({
    skills: [
      {
        id: '3b7593c3-3a2d-45a4-a47d-47e8a1c8136b',
        name: 'review',
        description: 'Review this text',
      },
    ],
  })
  await userEvent.click(screen.getByRole('button', { name: /Ask AI/ }))
  const box = screen.getByRole('textbox', { name: 'Ask a question' })
  await expect.element(box).toBeVisible()
  await expect
    .element(screen.getByText('Ask a question', { exact: true }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Send' }))
    .toBeDisabled()

  await userEvent.click(screen.getByRole('button', { name: 'Add context' }))
  await expect
    .element(screen.getByRole('searchbox', { name: 'Search context' }))
    .toBeVisible()
  await expect.element(screen.getByText('File', { exact: true })).toBeVisible()
  await expect
    .element(screen.getByText('Skills', { exact: true }))
    .toBeVisible()
  await userEvent.click(screen.getByRole('option', { name: /review/ }))
  await expect.element(box).toHaveValue('/review ')
})

it("shows this month's use as a ring and stops asking when it is spent", async () => {
  const first = await setup({ usage: { used: 1_200_000, limit: 3_000_000 } })
  await userEvent.click(first.screen.getByRole('button', { name: /Ask AI/ }))
  await expect
    .element(first.screen.getByRole('link', { name: /40%/ }))
    .toHaveAttribute('href', '/settings/ai')
})

it('disables Send with the reset date once the limit is spent', async () => {
  const { screen } = await setup({
    usage: { used: 3_000_000, limit: 3_000_000 },
  })
  await userEvent.click(screen.getByRole('button', { name: /Ask AI/ }))
  await userEvent.fill(
    screen.getByRole('textbox', { name: 'Ask a question' }),
    'Anything'
  )
  await expect
    .element(screen.getByRole('button', { name: 'Send' }))
    .toBeDisabled()
  await expect.element(screen.getByText(/limit is spent.*Nov 1/)).toBeVisible()
})
