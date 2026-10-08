import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { ArchitectureUses } from './architecture-uses'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
    [key: string]: unknown
  }) => {
    let href = to
    for (const [k, v] of Object.entries(params ?? {}))
      href = href.replace(`$${k}`, v)
    if (search) href += `?${new URLSearchParams(search)}`
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  },
}))

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const canvasID = 'c2f973dd-b554-4540-95c0-4697726ad6e2'
const elementID = 'd3f973dd-b554-4540-95c0-4697726ad6e3'

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ArchitectureUses workspaceID={workspaceID} documentID={documentID} />
    </QueryClientProvider>
  )

describe('where a document is used on canvases', () => {
  it('links to the element on each canvas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse([
            {
              architectureId: canvasID,
              title: 'Prod',
              elementId: elementID,
              elementKind: 'system',
              elementName: 'Backend Order',
            },
          ])
        )
      )
    )
    const screen = await mount()
    const link = screen.getByRole('link', { name: 'Prod › Backend Order' })
    await expect.element(link).toBeVisible()
    await expect
      .element(link)
      .toHaveAttribute(
        'href',
        `/docs/${canvasID}?nodeId=${elementID}&workspaceId=${workspaceID}`
      )
  })

  it('shows nothing when no canvas uses it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse([])))
    )
    const screen = await mount()
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.container.textContent).toBe('')
  })
})
