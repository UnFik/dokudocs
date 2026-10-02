import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { CreateWorkspaceDialog } from './create-workspace-dialog'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'

function renderDialog(onOpenChange = vi.fn()) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CreateWorkspaceDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>
  )
}

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
  useDokudocsStore.setState({ activeOrgId: 'org-1' })
})

describe('CreateWorkspaceDialog', () => {
  it('validates the name and creates the workspace through the API', async () => {
    let workspaces: Array<Record<string, string>> = []
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const workspace = {
          id: workspaceId,
          name: JSON.parse(String(init.body)).name,
          plan: 'Free',
          logoUrl: '',
          role: 'owner',
        }
        workspaces = [workspace]
        return Promise.resolve(jsonResponse(workspace, 201))
      }
      return Promise.resolve(jsonResponse(workspaces))
    })
    vi.stubGlobal('fetch', fetch)
    const onOpenChange = vi.fn()
    const screen = await renderDialog(onOpenChange)

    await screen.getByRole('button', { name: 'Create Workspace' }).click()
    await expect
      .element(screen.getByText('Please enter a workspace name'))
      .toBeVisible()
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces'),
      expect.objectContaining({ method: 'POST' })
    )

    await screen.getByLabelText('Workspace Name').fill('  Architecture Team  ')
    await screen.getByRole('button', { name: 'Create Workspace' }).click()

    await vi.waitFor(() =>
      expect(useDokudocsStore.getState().activeOrgId).toBe(workspaceId)
    )
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/workspaces'),
      expect.objectContaining({ method: 'POST' })
    )
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      name: 'Architecture Team',
    })
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
