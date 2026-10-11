import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import type { DocumentItem } from '@/types/dokudocs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { RenameDocDialog } from './rename-doc-dialog'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const docId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))

const document = {
  id: docId,
  orgId: workspaceId,
  title: 'Old spec',
} as DocumentItem

beforeEach(() => {
  success.mockReset()
  error.mockReset()
  useAuthStore.getState().auth.setSession(testSession())
})
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

async function submitRename(response: Response) {
  const fetch = vi.fn(() => Promise.resolve(response))
  vi.stubGlobal('fetch', fetch)
  const onOpenChange = vi.fn()
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <RenameDocDialog open onOpenChange={onOpenChange} document={document} />
    </QueryClientProvider>
  )
  await screen.getByLabelText('Document Title').fill('  New name ')
  await screen.getByRole('button', { name: 'Save Changes' }).click()
  return { fetch, onOpenChange }
}

it('renames on the server and closes only after it answers', async () => {
  const { fetch, onOpenChange } = await submitRename(
    jsonResponse({
      id: docId,
      workspaceId,
      title: 'New name',
      type: 'markdown',
      content: '',
      authorId: 'b4d13df7-76a2-4da5-8817-91d40f832abd',
      author: {
        id: 'b4d13df7-76a2-4da5-8817-91d40f832abd',
        name: 'A',
        email: 'a@b.c',
      },
      isDraft: true,
      visibility: 'workspace',
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-09T00:00:00Z',
    })
  )
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(new URL(url).pathname).toBe(`/api/v1/documents/${docId}`)
  expect(init.method).toBe('PUT')
  expect(new Headers(init.headers).get('X-Workspace-Id')).toBe(workspaceId)
  expect(JSON.parse(String(init.body))).toEqual({ title: 'New name' })
  expect(success).toHaveBeenCalledWith('Document renamed to "New name"')
})

it('stays open and shows the error when the server refuses', async () => {
  const { onOpenChange } = await submitRename(
    jsonResponse({ title: 'Forbidden' }, 403)
  )
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Forbidden'))
  expect(onOpenChange).not.toHaveBeenCalled()
})
