import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { ImportDocDialog } from './import-doc-dialog'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
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

describe('ImportDocDialog', () => {
  it('creates imported Markdown through the API with the editor document', async () => {
    const createdID = crypto.randomUUID()
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      if (path === '/api/v1/workspaces')
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
        <ImportDocDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    )
    await screen
      .getByLabelText('Import document file')
      .upload(
        new File(['# Imported guide\n\nBody text\n'], 'imported-guide.md')
      )
    await screen
      .getByRole('button', { name: 'Import Document', exact: true })
      .click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
    const [, request] = fetch.mock.calls.find(
      ([input, init]) =>
        new URL(String(input)).pathname === '/api/v1/documents' &&
        init?.method === 'POST'
    )!
    const payload = JSON.parse(String(request?.body))
    expect(payload).toMatchObject({
      title: 'Imported Guide',
      type: 'markdown',
      isDraft: true,
      contentJSON: { type: 'doc' },
    })
    expect(payload.content).toEqual(expect.any(String))
    expect(JSON.stringify(payload.contentJSON)).toContain('atx_heading')
    expect(JSON.stringify(payload.contentJSON)).toContain('paragraph')
    expect(payload).not.toHaveProperty('initialBody')
    expect(new Headers(request?.headers).get('Idempotency-Key')).toEqual(
      expect.any(String)
    )
    expect(navigate).toHaveBeenCalledWith({
      to: '/docs/$docId',
      params: { docId: createdID },
    })
  })

  it('keeps the unauthenticated demo import in local storage', async () => {
    useAuthStore.getState().auth.reset()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportDocDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    )

    await screen
      .getByLabelText('Import document file')
      .upload(new File(['# Demo guide\n'], 'demo-guide.md'))
    await screen
      .getByRole('button', { name: 'Import Document', exact: true })
      .click()

    await vi.waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(fetch).not.toHaveBeenCalled()
    expect(useDokudocsStore.getState().documents[0]).toMatchObject({
      title: 'Demo Guide',
      type: 'markdown',
      content: '# Demo guide',
    })
  })
})
