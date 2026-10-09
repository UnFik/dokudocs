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

function mockDocumentAPI(type: 'markdown' | 'architecture') {
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
            type,
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

  return { fetch, createdID }
}

describe('ImportDocDialog', () => {
  it('creates imported Markdown through the API with the editor document', async () => {
    const { fetch, createdID } = mockDocumentAPI('markdown')

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

  it('imports an Architecture canvas through the API without losing its nodes', async () => {
    const canvas = {
      version: 1,
      nodes: [
        { id: 'api', kind: 'system', name: 'API', x: 12, y: 34, links: [] },
        {
          id: 'db',
          kind: 'system',
          name: 'Database',
          x: 400,
          y: 100,
          links: [],
        },
      ],
      connections: [
        {
          id: 'api-db',
          source: 'api',
          target: 'db',
          protocol: 'TCP',
          port: '5432',
          label: 'Queries',
          links: [],
        },
      ],
    }
    const { fetch, createdID } = mockDocumentAPI('architecture')

    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportDocDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>
    )
    await screen
      .getByLabelText('Import document file')
      .upload(new File([JSON.stringify(canvas)], 'imported-canvas.json'))
    await screen
      .getByRole('button', { name: 'Architecture', exact: true })
      .click()
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
      title: 'Imported Canvas',
      type: 'architecture',
      isDraft: true,
      contentJSON: canvas,
    })
    expect(payload).not.toHaveProperty('content')
    expect(payload).not.toHaveProperty('initialBody')
    expect(new Headers(request?.headers).get('Idempotency-Key')).toEqual(
      expect.any(String)
    )
    expect(navigate).toHaveBeenCalledWith({
      to: '/docs/$docId',
      params: { docId: createdID },
    })
  })

  it.each([
    '{"version":2,"nodes":[],"connections":[]}',
    '{"version":1,"nodes":[null],"connections":[]}',
  ])(
    'shows an error instead of importing invalid Architecture JSON: %s',
    async (content) => {
      useAuthStore.getState().auth.reset()
      const screen = await render(
        <QueryClientProvider client={new QueryClient()}>
          <ImportDocDialog open onOpenChange={vi.fn()} />
        </QueryClientProvider>
      )
      await screen
        .getByLabelText('Import document file')
        .upload(new File([content], 'invalid.json'))
      await screen
        .getByRole('button', { name: 'Architecture', exact: true })
        .click()
      await screen
        .getByRole('button', { name: 'Import Document', exact: true })
        .click()
      await expect
        .element(screen.getByRole('alert'))
        .toHaveTextContent(
          'Choose a valid Architecture JSON export (version 1).'
        )
      expect(navigate).not.toHaveBeenCalled()
      expect(useDokudocsStore.getState().documents).toHaveLength(0)
    }
  )

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
