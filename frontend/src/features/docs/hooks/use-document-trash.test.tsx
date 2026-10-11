import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useMoveToTrash } from './use-document-trash'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const docId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))

const document = { id: docId, orgId: workspaceId, title: 'Old spec' }
const requests: { path: string; method: string; workspace: string | null }[] =
  []

beforeEach(() => {
  requests.length = 0
  success.mockReset()
  error.mockReset()
  useAuthStore.getState().auth.setSession(testSession())
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

function stubFetch(status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        path: new URL(String(input)).pathname,
        method: init?.method ?? 'GET',
        workspace: new Headers(init?.headers).get('X-Workspace-Id'),
      })
      return Promise.resolve(
        status === 200
          ? jsonResponse({ status: 'ok' })
          : jsonResponse({ title: 'Forbidden' }, status)
      )
    })
  )
}

it('moves a document to trash in its workspace and offers Undo that restores it', async () => {
  stubFetch()
  const { result } = await renderHook(() => useMoveToTrash(), { wrapper })
  result.current.mutate(document)
  await vi.waitFor(() => expect(success).toHaveBeenCalledOnce())
  expect(requests[0]).toEqual({
    path: `/api/v1/documents/${docId}`,
    method: 'DELETE',
    workspace: workspaceId,
  })
  const options = success.mock.calls[0][1] as {
    action: { label: string; onClick: () => void }
  }
  expect(options.action.label).toBe('Undo')
  options.action.onClick()
  await vi.waitFor(() =>
    expect(requests).toContainEqual({
      path: `/api/v1/documents/${docId}/restore`,
      method: 'POST',
      workspace: workspaceId,
    })
  )
})

it('reports the server error and does not claim the document was trashed', async () => {
  stubFetch(403)
  const { result } = await renderHook(() => useMoveToTrash(), { wrapper })
  result.current.mutate(document)
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Forbidden'))
  expect(success).not.toHaveBeenCalled()
})
