import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useAuthStore } from '@/stores/auth-store'
import { ElementComments, OrphanedComments } from './element-comments'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const author = testSession().user.id
const thread = (
  id: string,
  elementId: string,
  content: string,
  resolved = false
) => ({
  id,
  documentId: documentID,
  authorId: author,
  authorName: 'Sari',
  selectedText: 'Backend Order',
  content,
  anchor: { kind: 'element', elementId },
  createdAt: '2026-10-08T00:00:00Z',
  resolvedAt: resolved ? '2026-10-08T01:00:00Z' : null,
  replies: [],
})

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function stub(threads: unknown[]) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/comments') && (!init?.method || init.method === 'GET'))
      return jsonResponse(threads)
    if (path.endsWith('/mentionable'))
      return jsonResponse([
        {
          userId: '33333333-3333-4333-8333-333333333333',
          name: 'Dewi Lestari',
          email: 'dewi@example.com',
          canRead: true,
        },
      ])
    if (init?.method === 'POST') return new Response(null, { status: 201 })
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('comments on a canvas element', () => {
  it('lists the threads on the selected element only, and starts one anchored to it', async () => {
    const fetch = stub([
      thread(
        '11111111-1111-4111-8111-111111111111',
        'api',
        'Is this behind the gateway?'
      ),
      thread('22222222-2222-4222-8222-222222222222', 'db', 'Other element'),
    ])
    const onChanged = vi.fn()
    const screen = await render(
      <QueryClientProvider client={client()}>
        <ElementComments
          workspaceID={workspaceID}
          documentID={documentID}
          elementID='api'
          elementName='Backend Order'
          canComment
          onChanged={onChanged}
        />
      </QueryClientProvider>
    )
    await expect
      .element(screen.getByText('Is this behind the gateway?'))
      .toBeVisible()
    expect(screen.container.textContent).not.toContain('Other element')

    await screen
      .getByLabelText('New comment on Backend Order')
      .fill('Yes, through Nginx.')
    await screen.getByRole('button', { name: 'Comment' }).click()
    await vi.waitFor(() => {
      const post = fetch.mock.calls.find(
        ([input, init]) =>
          init?.method === 'POST' && String(input).endsWith('/comments')
      )
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        content: 'Yes, through Nginx.',
        selectedText: 'Backend Order',
        anchor: { kind: 'element', elementId: 'api' },
      })
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('mentions a person from the workspace, and shows a stored mention as a name', async () => {
    const fetch = stub([
      thread(
        '11111111-1111-4111-8111-111111111111',
        'api',
        'cc @[Dewi Lestari](user:33333333-3333-4333-8333-333333333333) please'
      ),
    ])
    const screen = await render(
      <QueryClientProvider client={client()}>
        <ElementComments
          workspaceID={workspaceID}
          documentID={documentID}
          elementID='api'
          elementName='Backend Order'
          canComment
          onChanged={vi.fn()}
        />
      </QueryClientProvider>
    )
    await expect.element(screen.getByText('@Dewi Lestari')).toBeVisible()
    const chip = screen.container.querySelector('[data-mention]')
    expect(chip?.textContent).toBe('@Dewi Lestari')
    expect(screen.container.textContent).not.toContain('user:')

    await screen.getByLabelText('New comment on Backend Order').click()
    await userEvent.keyboard('Thanks @dew')
    await screen.getByRole('option', { name: /Dewi Lestari/ }).click()
    await screen.getByRole('button', { name: 'Comment' }).click()
    await vi.waitFor(() => {
      const post = fetch.mock.calls.find(
        ([input, init]) =>
          init?.method === 'POST' && String(input).endsWith('/comments')
      )
      expect(JSON.parse(String(post?.[1]?.body)).content).toBe(
        'Thanks @[Dewi Lestari](user:33333333-3333-4333-8333-333333333333)'
      )
    })
  })

  it('cannot be written by someone who may only view', async () => {
    stub([])
    const screen = await render(
      <QueryClientProvider client={client()}>
        <ElementComments
          workspaceID={workspaceID}
          documentID={documentID}
          elementID='api'
          elementName='Backend Order'
          canComment={false}
          onChanged={vi.fn()}
        />
      </QueryClientProvider>
    )
    await expect
      .element(screen.getByText('No comments on this element.'))
      .toBeVisible()
    expect(screen.container.querySelector('textarea')).toBeNull()
  })

  it('keeps the threads of removed elements readable', async () => {
    stub([
      thread(
        '33333333-3333-4333-8333-333333333333',
        'gone',
        'What replaced this?'
      ),
    ])
    const screen = await render(
      <QueryClientProvider client={client()}>
        <OrphanedComments
          workspaceID={workspaceID}
          documentID={documentID}
          elementIDs={new Set(['api'])}
        />
      </QueryClientProvider>
    )
    await expect.element(screen.getByText('What replaced this?')).toBeVisible()
    await expect
      .element(screen.getByText(/on an element that was removed/))
      .toBeVisible()
  })
})
