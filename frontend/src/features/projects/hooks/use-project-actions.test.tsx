import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import type { ProjectItem } from '@/types/dokudocs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  useAddCategory,
  useDeleteCategory,
  useRenameCategory,
  useReorderCategories,
  useUpdateProject,
} from './use-project-actions'
import {
  useProjectMembers,
  useRemoveProjectMember,
  useSetProjectMember,
} from './use-project-members'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const projectId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const userId = 'b4d13df7-76a2-4da5-8817-91d40f832abd'
const { error } = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error } }))

const project: Pick<ProjectItem, 'id' | 'orgId' | 'categoryIds'> = {
  id: projectId,
  orgId: workspaceId,
  categoryIds: { API: 'c1', Billing: 'c2' },
}
type Request = {
  path: string
  method: string
  workspace: string | null
  body: unknown
}
const requests: Request[] = []
let failWith: number | null = null

beforeEach(() => {
  requests.length = 0
  failWith = null
  error.mockReset()
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        path: new URL(String(input)).pathname,
        method: init?.method ?? 'GET',
        workspace: new Headers(init?.headers).get('X-Workspace-Id'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (failWith)
        return Promise.resolve(jsonResponse({ title: 'Nope' }, failWith))
      if (init?.method === undefined && String(input).endsWith('/members'))
        return Promise.resolve(
          jsonResponse([
            {
              id: `${projectId}:${userId}`,
              projectId,
              userId,
              role: 'editor',
              createdAt: '2026-10-01T00:00:00Z',
              user: { id: userId, name: 'Ada', email: 'ada@example.com' },
            },
          ])
        )
      return Promise.resolve(jsonResponse({ status: 'ok' }))
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

const base = `/api/v1/projects/${projectId}`

it('saves a project and sends empty strings so description and logo can be cleared', async () => {
  const { result } = await renderHook(() => useUpdateProject(), { wrapper })
  result.current.mutate({
    project,
    input: { name: 'Payments', description: '', logoUrl: '' },
  })
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]).toEqual({
    path: base,
    method: 'PUT',
    workspace: workspaceId,
    body: { name: 'Payments', description: '', logoUrl: '' },
  })
})

it('adds, renames and deletes categories by their server ids', async () => {
  const add = await renderHook(() => useAddCategory(), { wrapper })
  add.result.current.mutate({ project, name: 'Ops', colorId: 'red' })
  const rename = await renderHook(() => useRenameCategory(), { wrapper })
  rename.result.current.mutate({
    project,
    name: 'API',
    newName: 'Public API',
    colorId: 'blue',
  })
  const remove = await renderHook(() => useDeleteCategory(), { wrapper })
  remove.result.current.mutate({ project, name: 'Billing' })
  await vi.waitFor(() =>
    expect(requests.filter((r) => r.method !== 'GET')).toHaveLength(3)
  )
  const writes = requests.filter((r) => r.method !== 'GET')
  expect(writes).toContainEqual({
    path: `${base}/categories`,
    method: 'POST',
    workspace: workspaceId,
    body: { name: 'Ops', colorId: 'red' },
  })
  expect(writes).toContainEqual({
    path: `${base}/categories/c1`,
    method: 'PUT',
    workspace: workspaceId,
    body: { name: 'Public API', colorId: 'blue' },
  })
  expect(writes).toContainEqual({
    path: `${base}/categories/c2`,
    method: 'DELETE',
    workspace: workspaceId,
    body: undefined,
  })
})

it('reorders by id and puts the old order back when the server refuses', async () => {
  failWith = 500
  const queryClient = new QueryClient()
  queryClient.setQueryData(
    ['projects', workspaceId],
    [{ ...project, categories: ['API', 'Billing'] }]
  )
  const { result } = await renderHook(() => useReorderCategories(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
  result.current.mutate({ project, names: ['Billing', 'API'] })
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Nope'))
  expect(requests[0]).toEqual({
    path: `${base}/categories/reorder`,
    method: 'PUT',
    workspace: workspaceId,
    body: { categoryIds: ['c2', 'c1'] },
  })
  expect(
    queryClient.getQueryData<{ categories: string[] }[]>([
      'projects',
      workspaceId,
    ])?.[0].categories
  ).toEqual(['API', 'Billing'])
})

it('says so instead of calling the server for a category it has no id for', async () => {
  const { result } = await renderHook(() => useRenameCategory(), { wrapper })
  result.current.mutate({
    project,
    name: 'Unknown',
    newName: 'X',
    colorId: 'blue',
  })
  await vi.waitFor(() => expect(error).toHaveBeenCalled())
  expect(requests).toHaveLength(0)
})

it('lists, sets and removes project members through the API', async () => {
  const members = await renderHook(() => useProjectMembers(project, true), {
    wrapper,
  })
  await vi.waitFor(() => expect(members.result.current.data).toHaveLength(1))
  expect(members.result.current.data?.[0]).toMatchObject({
    userId,
    role: 'editor',
    user: { email: 'ada@example.com' },
  })
  const set = await renderHook(() => useSetProjectMember(), { wrapper })
  set.result.current.mutate({
    project,
    email: 'bob@example.com',
    role: 'viewer',
  })
  const remove = await renderHook(() => useRemoveProjectMember(), { wrapper })
  remove.result.current.mutate({ project, userId })
  await vi.waitFor(() =>
    expect(requests.filter((r) => r.method !== 'GET')).toHaveLength(2)
  )
  const writes = requests.filter((r) => r.method !== 'GET')
  expect(writes).toContainEqual({
    path: `${base}/members`,
    method: 'POST',
    workspace: workspaceId,
    body: { email: 'bob@example.com', role: 'viewer' },
  })
  expect(writes).toContainEqual({
    path: `${base}/members/${userId}`,
    method: 'DELETE',
    workspace: workspaceId,
    body: undefined,
  })
})
