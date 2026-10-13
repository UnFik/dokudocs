import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { SidebarProvider } from '@/components/ui/sidebar'
import { RAGChatPage } from './rag-chat-page'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const idA = '65b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const opsID = 'a5b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const idDoc = '95b7593c-3a2d-45a4-a47d-47e8a1c8136b'
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const hour = 3_600_000

const chat = (id: string, title: string, extra: object = {}) => ({
  id,
  workspaceId: workspaceID,
  title,
  unread: false,
  createdAt: ago(48 * hour),
  updatedAt: ago(2 * hour),
  ...extra,
})

type Call = { method: string; path: string; body: unknown }

function setup(listed = [chat(idA, 'Deploy checklist', { unread: true })]) {
  useAuthStore.getState().auth.setSession(testSession())
  useDokudocsStore.setState({ activeOrgId: workspaceID })
  const calls: Call[] = []
  const known = [
    ...listed,
    chat(idDoc, 'About the runbook', { documentId: documentID }),
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path: url.pathname, body })
      if (url.pathname === '/api/v1/workspaces')
        return jsonResponse([
          {
            id: workspaceID,
            name: 'Engineering',
            plan: 'Free',
            role: 'member',
          },
        ])
      if (url.pathname === '/api/v1/rag/conversations' && method === 'GET')
        return jsonResponse(listed)
      if (url.pathname === '/api/v1/rag/usage')
        return jsonResponse({
          used: 10,
          limit: 300000,
          resetsAt: '2026-11-01T00:00:00Z',
        })
      if (url.pathname === '/api/v1/skills') return jsonResponse({ skills: [] })
      const one = /^\/api\/v1\/rag\/conversations\/([^/]+)$/.exec(url.pathname)
      if (one && method === 'GET')
        return jsonResponse({
          conversation: known.find((item) => item.id === one[1]),
          messages: [],
          actions: [],
        })
      if (one && method === 'PATCH')
        return jsonResponse({ ...known.find((i) => i.id === one[1]), ...body })
      if (/\/read$/.test(url.pathname))
        return new Response(null, { status: 204 })
      if (url.pathname === '/api/v1/rag/categories')
        return jsonResponse([
          { id: opsID, name: 'Ops', projectName: 'Platform' },
        ])
      if (/\/runs$/.test(url.pathname) && method === 'POST')
        return jsonResponse(
          {
            id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
            kind: 'chat',
            status: 'failed',
            draft: '',
            sequence: 0,
            error: 'stopped by the test',
          },
          202
        )
      if (/\/runs$/.test(url.pathname)) return jsonResponse(null)
      return jsonResponse({ title: 'not found' }, 404)
    })
  )
  return {
    calls,
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
  useAuthStore.getState().auth.reset()
  useDokudocsStore.setState({ activeOrgId: 'org-1' })
})

const page = (queryClient: QueryClient) =>
  render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <RAGChatPage />
      </SidebarProvider>
    </QueryClientProvider>
  )

it('lists chats with their age and unread marker, and pins one from its row', async () => {
  const { calls, queryClient } = setup()
  const screen = await page(queryClient)
  const list = screen.getByRole('list', { name: 'Chats' })
  await expect.element(list.getByText('Deploy checklist')).toBeVisible()
  await expect.element(list.getByText('2h')).toBeVisible()
  await expect.element(list.getByText('Unread')).toBeVisible()

  await userEvent.hover(list.getByText('Deploy checklist'))
  await userEvent.click(
    screen.getByRole('button', { name: 'Pin Deploy checklist' })
  )
  await vi.waitFor(() =>
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      pinned: true,
    })
  )
})

it('marks the open chat read once it is on screen', async () => {
  const { calls, queryClient } = setup()
  await page(queryClient)
  await vi.waitFor(() =>
    expect(
      calls.some(
        (c) =>
          c.method === 'POST' &&
          c.path === `/api/v1/rag/conversations/${idA}/read`
      )
    ).toBe(true)
  )
})

it('puts the chat name, the options and a new chat in one header, without a close button', async () => {
  const { queryClient } = setup()
  const screen = await page(queryClient)
  await expect
    .element(screen.getByRole('button', { name: 'Chat options' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'New chat' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Close' }))
    .not.toBeInTheDocument()
})

it('opens a document chat by id from the URL even though the list does not carry it', async () => {
  window.history.replaceState(null, '', `/assistant?conversation=${idDoc}`)
  const { calls, queryClient } = setup()
  const screen = await page(queryClient)
  await expect
    .element(screen.getByRole('heading', { name: 'About the runbook' }))
    .toBeVisible()
  expect(
    calls.some(
      (c) =>
        c.method === 'GET' && c.path === `/api/v1/rag/conversations/${idDoc}`
    )
  ).toBe(true)
})

it('narrows a workspace question to a category', async () => {
  const { calls, queryClient } = setup()
  const screen = await page(queryClient)
  await userEvent.click(screen.getByRole('button', { name: 'Add context' }))
  await userEvent.click(screen.getByRole('option', { name: /Ops/ }))
  await expect
    .element(screen.getByRole('button', { name: 'Remove category Ops' }))
    .toBeVisible()
  await userEvent.fill(
    screen.getByRole('textbox', { name: 'Ask a question' }),
    'Restart steps'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  await vi.waitFor(() =>
    expect(
      calls.find((c) => c.method === 'POST' && /\/runs$/.test(c.path))?.body
    ).toMatchObject({ question: 'Restart steps', categoryIds: [opsID] })
  )
})
