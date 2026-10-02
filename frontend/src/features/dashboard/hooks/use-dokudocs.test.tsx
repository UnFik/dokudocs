import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { useDokudocsStore } from '@/stores/dokudocs-store'
import { useDokudocs } from './use-dokudocs'

const workspaceId = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const userId = 'b4d13df7-76a2-4da5-8817-91d40f832abd'
const docId = 'b1f973dd-b554-4540-95c0-4697726ad6e1'

function queryWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useDokudocs', () => {
  beforeEach(() => {
    useAuthStore.getState().auth.setSession(testSession())
    useDokudocsStore.setState({ activeOrgId: workspaceId, searchQuery: '' })
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
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
        if (path === '/api/v1/projects')
          return Promise.resolve(jsonResponse([]))
        if (path === '/api/v1/documents') {
          return Promise.resolve(
            jsonResponse([
              {
                id: docId,
                workspaceId,
                projectId: null,
                title: 'API contract',
                type: 'markdown',
                content: '# API contract',
                authorId: userId,
                author: {
                  id: userId,
                  name: 'Test User',
                  email: 'user@example.com',
                  avatar: '',
                },
                tags: [],
                isDraft: false,
                visibility: 'workspace',
                isStarred: false,
                isShared: false,
                categories: [],
                createdAt: '2026-09-28T00:00:00.000Z',
                updatedAt: '2026-09-28T00:00:00.000Z',
              },
            ])
          )
        }
        throw new Error(`Unexpected request: ${path}`)
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useAuthStore.getState().auth.reset()
    useDokudocsStore.setState({ activeOrgId: 'org-1', searchQuery: '' })
  })

  it('loads workspace, projects, and documents from the API', async () => {
    const { result } = await renderHook(() => useDokudocs(), {
      wrapper: queryWrapper(),
    })

    await vi.waitFor(() => expect(result.current.documents).toHaveLength(1))

    expect(result.current.activeOrg).toMatchObject({
      id: workspaceId,
      name: 'Engineering',
    })
    expect(result.current.documents[0]).toMatchObject({
      id: docId,
      title: 'API contract',
      orgId: workspaceId,
    })
    expect(result.current.activeDocuments).toHaveLength(1)
    expect(result.current.projects).toEqual([])
  })

  it('applies dashboard search to documents loaded from the API', async () => {
    const { result } = await renderHook(() => useDokudocs(), {
      wrapper: queryWrapper(),
    })

    await vi.waitFor(() => expect(result.current.documents).toHaveLength(1))
    useDokudocsStore.getState().setSearchQuery('missing')
    await vi.waitFor(() => expect(result.current.activeDocuments).toEqual([]))
  })

  it('exposes server errors instead of presenting them as an empty workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
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
        if (path === '/api/v1/projects')
          return Promise.resolve(jsonResponse([]))
        return Promise.resolve(
          jsonResponse({ title: 'Backend unavailable' }, 503)
        )
      })
    )

    const { result } = await renderHook(() => useDokudocs(), {
      wrapper: queryWrapper(),
    })

    await vi.waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.error?.message).toBe('Backend unavailable')
  })

  it('exposes workspace loading failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ title: 'Workspace unavailable' }, 503)
        )
    )
    const { result } = await renderHook(() => useDokudocs(), {
      wrapper: queryWrapper(),
    })

    await vi.waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.error?.message).toBe('Workspace unavailable')
  })
})
