import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { SidebarProvider } from '@/components/ui/sidebar'
import { NotificationsInbox } from './notifications-inbox'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const threadID = '11111111-1111-4111-8111-111111111111'

const note = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  kind: 'comment_mention',
  title: 'Sari mentioned you in “Order flow”',
  body: 'can you check this?',
  read: false,
  createdAt: '2026-10-10T00:00:00Z',
  path: `/docs/${documentID}?workspaceId=${workspaceID}&thread=${threadID}`,
  ...over,
})

beforeEach(() => {
  navigate.mockReset()
  useAuthStore.getState().auth.setSession(testSession())
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function stub(notes: unknown[] | 'fail') {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/notifications/read'))
      return new Response(null, { status: 204 })
    if (path.endsWith('/notifications')) {
      return notes === 'fail'
        ? new Response('{}', { status: 503 })
        : jsonResponse(notes)
    }
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SidebarProvider>
        <NotificationsInbox />
      </SidebarProvider>
    </QueryClientProvider>
  )

describe('NotificationsInbox', () => {
  it('counts the unread mentions, lists them, and marks only mentions read when opened', async () => {
    const fetch = stub([
      note({}),
      note({ read: true, title: 'Bo mentioned you in “Schema”' }),
      note({ kind: 'catalog_request', title: '“Acme MQ” is in the catalog' }),
    ])
    const screen = await mount()
    await expect.element(screen.getByText('1 new')).toBeVisible()

    await screen.getByRole('button', { name: /Notifications/ }).click()
    await expect
      .element(screen.getByText('Sari mentioned you in “Order flow”'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Bo mentioned you in “Schema”'))
      .toBeVisible()
    expect(document.body.textContent).not.toContain('Acme MQ')
    await vi.waitFor(() => {
      const read = fetch.mock.calls.find(([input]) =>
        String(input).endsWith('/notifications/read')
      )
      expect(JSON.parse(String(read?.[1]?.body))).toEqual({
        kind: 'comment_mention',
      })
    })
  })

  it('opens the document on the thread when a mention is clicked', async () => {
    stub([note({})])
    const screen = await mount()
    await screen.getByRole('button', { name: /Notifications/ }).click()
    // The test page has no stylesheet, so the list can sit off screen; click the element itself.
    ;(
      screen
        .getByRole('button', { name: /Sari mentioned you/ })
        .element() as HTMLElement
    ).click()
    expect(navigate).toHaveBeenCalledWith({
      to: '/docs/$docId',
      params: { docId: documentID },
      search: { workspaceId: workspaceID, thread: threadID },
    })
  })

  it('says there is nothing yet, and what would fill it', async () => {
    stub([])
    const screen = await mount()
    await screen.getByRole('button', { name: /Notifications/ }).click()
    await expect.element(screen.getByText(/No mentions yet/)).toBeVisible()
  })

  it('says so when the notifications cannot be loaded', async () => {
    stub('fail')
    const screen = await mount()
    await screen.getByRole('button', { name: /Notifications/ }).click()
    await expect
      .element(screen.getByText(/Could not load notifications/))
      .toBeVisible()
  })
})
