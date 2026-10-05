import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { CreateDocDialog } from './create-doc-dialog'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  navigate.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
  useDokudocsStore.setState({ documents: [] })
})

describe('CreateDocDialog', () => {
  it('creates a non-Markdown document on the server and opens its route', async () => {
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/workspaces') {
        return Promise.resolve(
          jsonResponse([
            {
              id: workspaceId,
              name: 'Engineering',
              plan: 'Free',
              role: 'owner',
            },
          ])
        )
      }
      if (path === '/api/v1/projects') return Promise.resolve(jsonResponse([]))
      if (path === '/api/v1/documents' && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              id: documentId,
              workspaceId,
              title: 'New system spec',
              type: 'dbdiagram',
              content: 'Table users { id int }',
              authorId: testSession().user.id,
              author: {
                id: testSession().user.id,
                name: 'Test User',
                email: 'user@example.com',
                avatar: '',
              },
              tags: [],
              isDraft: true,
              visibility: 'inherit',
              isStarred: false,
              isShared: false,
              categories: [],
              createdAt: '2026-09-28T00:00:00.000Z',
              updatedAt: '2026-09-28T00:00:00.000Z',
            },
            201
          )
        )
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetch)
    const onOpenChange = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <CreateDocDialog open onOpenChange={onOpenChange} />
      </QueryClientProvider>
    )

    await screen.getByLabelText(/Document Title/).fill('New system spec')
    await screen.getByRole('button', { name: 'Database Diagram' }).click()
    await screen.getByRole('button', { name: 'Create Document' }).click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
    const [, request] = fetch.mock.calls.find(
      ([input, init]) =>
        new URL(String(input)).pathname === '/api/v1/documents' &&
        init?.method === 'POST'
    )!
    expect(JSON.parse(String(request?.body))).toMatchObject({
      title: 'New system spec',
      type: 'dbdiagram',
      isDraft: true,
      visibility: 'inherit',
      content: expect.stringContaining('Table users'),
    })
    expect(navigate).toHaveBeenCalledWith({
      to: '/docs/$docId',
      params: { docId: documentId },
    })
    expect(
      useDokudocsStore.getState().documents.find((doc) => doc.id === documentId)
    ).toMatchObject({
      title: 'New system spec',
      content: 'Table users { id int }',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('creates Markdown through the API with the editor document as its content', async () => {
    const createdID = crypto.randomUUID()
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/workspaces') {
        return Promise.resolve(
          jsonResponse([
            {
              id: workspaceId,
              name: 'Engineering',
              plan: 'Free',
              role: 'owner',
            },
          ])
        )
      }
      if (path === '/api/v1/projects') return Promise.resolve(jsonResponse([]))
      if (path === '/api/v1/documents' && init?.method === 'POST') {
        const request = JSON.parse(String(init.body))
        return Promise.resolve(
          jsonResponse(
            {
              id: createdID,
              workspaceId,
              title: request.title,
              type: 'markdown',
              content: '',
              authorId: testSession().user.id,
              author: {
                id: testSession().user.id,
                name: 'Test User',
                email: 'user@example.com',
                avatar: '',
              },
              tags: [],
              isDraft: true,
              visibility: 'inherit',
              isStarred: false,
              isShared: false,
              categories: [],
              createdAt: '2026-09-28T00:00:00.000Z',
              updatedAt: '2026-09-28T00:00:00.000Z',
            },
            201
          )
        )
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetch)
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <CreateDocDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    )

    await screen.getByLabelText(/Document Title/).fill('Markdown draft')
    await screen.getByRole('button', { name: 'Create Document' }).click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
    const [, request] = fetch.mock.calls.find(
      ([input, init]) =>
        new URL(String(input)).pathname === '/api/v1/documents' &&
        init?.method === 'POST'
    )!
    const payload = JSON.parse(String(request?.body))
    expect(payload).toMatchObject({
      title: 'Markdown draft',
      type: 'markdown',
      content: expect.stringContaining('#'),
      contentJSON: { type: 'doc' },
    })
    expect(JSON.stringify(payload.contentJSON)).toContain('atx_heading')
    expect(payload).not.toHaveProperty('initialBody')
    expect(navigate).toHaveBeenCalledWith({
      to: '/docs/$docId',
      params: { docId: createdID },
    })
  })
})
