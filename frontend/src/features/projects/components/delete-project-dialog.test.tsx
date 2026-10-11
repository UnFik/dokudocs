import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import type { ProjectItem } from '@/types/dokudocs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { DeleteProjectDialog } from './delete-project-dialog'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const projectId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const { success, error } = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success, error } }))

const project: ProjectItem = {
  id: projectId,
  name: 'Payments',
  orgId: workspaceId,
  workspaceId,
  documentIds: [],
  createdAt: '2026-10-08T00:00:00Z',
  updatedAt: '2026-10-08T00:00:00Z',
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

async function renderDialog(onOpenChange = vi.fn()) {
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <DeleteProjectDialog open onOpenChange={onOpenChange} project={project} />
    </QueryClientProvider>
  )
  await screen.getByLabelText(/Type .* to confirm/).fill('Payments')
  await screen
    .getByRole('button', { name: 'Delete Project', exact: true })
    .click()
  return onOpenChange
}

it('deletes the project on the server and closes only after it answers', async () => {
  const fetch = vi.fn(() =>
    Promise.resolve(jsonResponse({ status: 'deleted' }))
  )
  vi.stubGlobal('fetch', fetch)
  const onOpenChange = await renderDialog()
  await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
  expect(new URL(url).pathname).toBe(`/api/v1/projects/${projectId}`)
  expect(init.method).toBe('DELETE')
  expect(new Headers(init.headers).get('X-Workspace-Id')).toBe(workspaceId)
  expect(success).toHaveBeenCalledOnce()
})

it('keeps the dialog open and reports the error when the server refuses', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse({ title: 'Forbidden' }, 403)))
  )
  const onOpenChange = await renderDialog()
  await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Forbidden'))
  expect(success).not.toHaveBeenCalled()
  expect(onOpenChange).not.toHaveBeenCalled()
})
