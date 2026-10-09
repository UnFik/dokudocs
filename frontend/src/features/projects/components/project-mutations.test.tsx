import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { listProjects } from '@/lib/domain-api'
import { CreateProjectDialog } from './create-project-dialog'
import { ProjectCard } from './project-card'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const projectId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}))

const project = {
  id: projectId,
  workspaceId,
  name: 'Payments',
  description: 'Checkout',
  categories: [{ name: 'General', colorId: 'blue' }],
  isStarred: false,
  createdAt: '2026-10-08T00:00:00Z',
  updatedAt: '2026-10-08T00:00:00Z',
}

function workspaceResponse() {
  return jsonResponse([
    { id: workspaceId, name: 'Engineering', plan: 'Free', role: 'owner' },
  ])
}

function ProjectUnderTest() {
  const { data = [] } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => listProjects(workspaceId),
  })
  return (
    data[0] && (
      <ProjectCard project={{ ...data[0], documents: [], totalDocsCount: 0 }} />
    )
  )
}

beforeEach(() => {
  useAuthStore.getState().auth.setSession(testSession())
  success.mockReset()
  error.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

describe('Project server mutations', () => {
  it('creates in the active workspace and waits for the server before showing success', async () => {
    let resolveCreate!: (response: Response) => void
    const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/workspaces'))
        return Promise.resolve(workspaceResponse())
      if (init?.method === 'POST')
        return new Promise<Response>((resolve) => {
          resolveCreate = resolve
        })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetch)
    const onOpenChange = vi.fn()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={client}>
        <CreateProjectDialog open onOpenChange={onOpenChange} />
      </QueryClientProvider>
    )
    await screen.getByLabelText('Project Name').fill(' Payments ')
    await screen
      .getByLabelText('Categories / Tags (Optional)')
      .fill('API, Billing, API')
    await screen
      .getByRole('button', { name: 'Create Project', exact: true })
      .click()
    await vi.waitFor(() =>
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
        true
      )
    )
    const [url, init] = fetch.mock.calls.find(
      ([, init]) => init?.method === 'POST'
    )!
    expect(new URL(String(url)).pathname).toBe('/api/v1/projects')
    expect(new Headers(init?.headers).get('X-Workspace-Id')).toBe(workspaceId)
    expect(JSON.parse(String(init?.body))).toMatchObject({
      name: 'Payments',
      categories: ['API', 'Billing'],
    })
    expect(success).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await expect
      .element(screen.getByRole('button', { name: 'Creating…' }))
      .toBeDisabled()
    resolveCreate(jsonResponse(project, 201))
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(success).toHaveBeenCalledOnce()
    expect(client.getQueryData(['projects', workspaceId])).toMatchObject([
      { id: projectId },
    ])
  })

  it('keeps the create form open when the server rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) =>
        Promise.resolve(
          String(url).endsWith('/workspaces')
            ? workspaceResponse()
            : jsonResponse({ title: 'Project creation failed' }, 500)
        )
      )
    )
    const onOpenChange = vi.fn()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={client}>
        <CreateProjectDialog open onOpenChange={onOpenChange} />
      </QueryClientProvider>
    )
    await screen.getByLabelText('Project Name').fill('Payments')
    await screen
      .getByRole('button', { name: 'Create Project', exact: true })
      .click()
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('Project creation failed')
    )
    expect(success).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('stars and unstars the server project and updates the card from the query cache', async () => {
    let starred = false
    const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        starred = !starred
        return Promise.resolve(jsonResponse({ isStarred: starred }))
      }
      return Promise.resolve(jsonResponse([{ ...project, isStarred: starred }]))
    })
    vi.stubGlobal('fetch', fetch)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={client}>
        <ProjectUnderTest />
      </QueryClientProvider>
    )
    await screen.getByTitle('Star Project', { exact: true }).click()
    await expect
      .element(screen.getByTitle('Unstar Project', { exact: true }))
      .toBeVisible()
    await screen.getByTitle('Unstar Project', { exact: true }).click()
    await expect
      .element(screen.getByTitle('Star Project', { exact: true }))
      .toBeVisible()
    const requests = fetch.mock.calls.filter(
      ([, init]) => init?.method === 'POST'
    )
    expect(requests).toHaveLength(2)
    for (const [url, init] of requests) {
      expect(new URL(String(url)).pathname).toBe(
        `/api/v1/projects/${projectId}/star`
      )
      expect(new Headers(init?.headers).get('X-Workspace-Id')).toBe(workspaceId)
    }
  })

  it('preserves the star state when the server fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'POST'
            ? jsonResponse({ title: 'Star failed' }, 500)
            : jsonResponse([project])
        )
      )
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={client}>
        <ProjectUnderTest />
      </QueryClientProvider>
    )
    await screen.getByTitle('Star Project', { exact: true }).click()
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Star failed'))
    await expect
      .element(screen.getByTitle('Star Project', { exact: true }))
      .toBeVisible()
    expect(success).not.toHaveBeenCalled()
  })
})
