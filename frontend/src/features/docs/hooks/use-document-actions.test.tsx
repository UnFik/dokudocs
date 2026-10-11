import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  useDuplicateDocument,
  useMoveDocument,
  useRecordDocumentView,
  useUpdateDocument,
} from './use-document-actions'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const userId = 'b4d13df7-76a2-4da5-8817-91d40f832abd'
const docId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const projectId = 'c2f973dd-b554-4540-95c0-4697726ad6e2'
const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))

const document = { id: docId, orgId: workspaceId, title: 'Old spec' }
const serverDocument = {
  id: docId,
  workspaceId,
  projectId: null,
  title: 'New name',
  type: 'markdown',
  content: '',
  authorId: userId,
  author: { id: userId, name: 'Ada', email: 'ada@example.com', avatar: '' },
  isDraft: true,
  visibility: 'workspace',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-09T00:00:00Z',
}
type Request = {
  path: string
  method: string
  workspace: string | null
  idempotencyKey: string | null
  body: unknown
}
const requests: Request[] = []
let failWith: number | null = null

beforeEach(() => {
  requests.length = 0
  failWith = null
  success.mockReset()
  error.mockReset()
  useAuthStore.getState().auth.setSession(testSession())
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      requests.push({
        path: new URL(String(input)).pathname,
        method: init?.method ?? 'GET',
        workspace: headers.get('X-Workspace-Id'),
        idempotencyKey: headers.get('Idempotency-Key'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })
      if (failWith)
        return Promise.resolve(jsonResponse({ title: 'Nope' }, failWith))
      return Promise.resolve(jsonResponse(serverDocument))
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

it('renames through the API in the document workspace', async () => {
  const { result } = await renderHook(() => useUpdateDocument(), { wrapper })
  result.current.mutate({
    document,
    input: { title: 'New name' },
    message: 'Renamed',
  })
  await vi.waitFor(() => expect(success).toHaveBeenCalledWith('Renamed'))
  expect(requests[0]).toMatchObject({
    path: `/api/v1/documents/${docId}`,
    method: 'PUT',
    workspace: workspaceId,
    body: { title: 'New name' },
  })
})

it('clears categories by sending an empty list', async () => {
  const { result } = await renderHook(() => useUpdateDocument(), { wrapper })
  result.current.mutate({ document, input: { categories: [] } })
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0].body).toEqual({ categories: [] })
})

it('duplicates with a fresh idempotency key per request', async () => {
  const { result } = await renderHook(() => useDuplicateDocument(), { wrapper })
  result.current.mutate(document)
  await vi.waitFor(() => expect(success).toHaveBeenCalledOnce())
  expect(requests[0]).toMatchObject({
    path: `/api/v1/documents/${docId}/duplicate`,
    method: 'POST',
    workspace: workspaceId,
  })
  expect(requests[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
})

it('moves to a project, and back to drafts with a null target', async () => {
  const { result } = await renderHook(() => useMoveDocument(), { wrapper })
  result.current.mutate({
    document,
    targetProjectId: projectId,
    targetName: 'Payments',
  })
  await vi.waitFor(() =>
    expect(success).toHaveBeenCalledWith('Moved "Old spec" to "Payments"')
  )
  result.current.mutate({ document, targetProjectId: null })
  await vi.waitFor(() =>
    expect(success).toHaveBeenCalledWith('Moved "Old spec" to Drafts')
  )
  expect(requests.map((r) => [r.path, r.method, r.body])).toEqual([
    [`/api/v1/documents/${docId}/move`, 'PUT', { targetProjectId: projectId }],
    [`/api/v1/documents/${docId}/move`, 'PUT', { targetProjectId: null }],
  ])
  expect(requests.every((r) => r.workspace === workspaceId)).toBe(true)
})

it('reports a server refusal and does not claim success', async () => {
  failWith = 403
  const { result } = await renderHook(() => useMoveDocument(), { wrapper })
  result.current.mutate({ document, targetProjectId: projectId })
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Nope'))
  expect(success).not.toHaveBeenCalled()
})

it('records a view in the document workspace', async () => {
  const { result } = await renderHook(() => useRecordDocumentView(), {
    wrapper,
  })
  result.current.mutate(document)
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  expect(requests[0]).toMatchObject({
    path: `/api/v1/documents/${docId}/view`,
    method: 'POST',
    workspace: workspaceId,
  })
})
