import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/auth-store'
import { addConnection, addSystem, readCanvas } from '../lib/canvas-doc'
import type { Selected } from '../lib/canvas-selection'
import { CommentsPanel, CommentsTabLabel } from './element-comments'

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

// "Backend Order" and "Database" on the canvas, wired together.
function sample() {
  const doc = new Y.Doc()
  const api = addSystem(doc, {
    catalog: 'golang',
    name: 'Backend Order',
    x: 0,
    y: 0,
    parentId: null,
  })
  const db = addSystem(doc, {
    catalog: 'postgresql',
    name: 'Database',
    x: 0,
    y: 100,
    parentId: null,
  })
  const link = addConnection(doc, {
    source: api,
    target: db,
    protocol: 'postgresql',
  })
  return { canvas: readCanvas(doc), api, db, link }
}

const only = (id: string): Selected[] => [{ kind: 'node', id }]

function mountPanel(options: {
  canvas: ReturnType<typeof readCanvas>
  selection?: Selected[]
  canComment?: boolean
  onChanged?: () => void
  onSelectElement?: (id: string) => void
}) {
  return render(
    <QueryClientProvider client={client()}>
      <CommentsPanel
        workspaceID={workspaceID}
        documentID={documentID}
        canvas={options.canvas}
        selection={options.selection ?? []}
        canComment={options.canComment ?? true}
        onChanged={options.onChanged ?? vi.fn()}
        onSelectElement={options.onSelectElement}
        showResolved={false}
        onShowResolved={vi.fn()}
      />
    </QueryClientProvider>
  )
}

const posted = (fetch: ReturnType<typeof stub>) =>
  fetch.mock.calls.find(
    ([input, init]) =>
      init?.method === 'POST' && String(input).endsWith('/comments')
  )

describe('the comments tab', () => {
  it('lists every thread of the document, filters to the selection, and keeps removed elements last', async () => {
    const { canvas, api, db } = sample()
    stub([
      thread(
        '33333333-3333-4333-8333-333333333333',
        'gone',
        'What replaced this?'
      ),
      thread(
        '11111111-1111-4111-8111-111111111111',
        api,
        'Is this behind the gateway?'
      ),
      thread(
        '22222222-2222-4222-8222-222222222222',
        db,
        'Which version runs here?'
      ),
    ])
    const screen = await mountPanel({ canvas, selection: only(api) })
    await expect
      .element(screen.getByText('Which version runs here?'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Is this behind the gateway?'))
      .toBeVisible()
    const text = screen.container.textContent ?? ''
    expect(text.indexOf('Is this behind the gateway?')).toBeLessThan(
      text.indexOf('What replaced this?')
    )
    expect(text.indexOf('Which version runs here?')).toBeLessThan(
      text.indexOf('What replaced this?')
    )
    await expect.element(screen.getByText(/removed element/)).toBeVisible()

    await screen.getByRole('button', { name: 'Selected' }).click()
    expect(screen.container.textContent).toContain(
      'Is this behind the gateway?'
    )
    expect(screen.container.textContent).not.toContain(
      'Which version runs here?'
    )
    expect(screen.container.textContent).not.toContain('What replaced this?')
  })

  it('starts a thread on the one selected element, anchored to it', async () => {
    const { canvas, api } = sample()
    const fetch = stub([])
    const onChanged = vi.fn()
    const screen = await mountPanel({ canvas, selection: only(api), onChanged })
    await screen
      .getByLabelText('New comment on Backend Order')
      .fill('Yes, through Nginx.')
    await screen.getByRole('button', { name: 'Comment', exact: true }).click()
    await vi.waitFor(() =>
      expect(JSON.parse(String(posted(fetch)?.[1]?.body))).toMatchObject({
        content: 'Yes, through Nginx.',
        selectedText: 'Backend Order',
        anchor: { kind: 'element', elementId: api },
      })
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('asks for an element to be selected before it takes a new thread', async () => {
    const { canvas } = sample()
    stub([])
    const screen = await mountPanel({ canvas })
    await expect.element(screen.getByText(/Select one element/)).toBeVisible()
    expect(screen.container.querySelector('textarea')).toBeNull()
  })

  it('takes a new thread on exactly one element, not on two', async () => {
    const { canvas, api, db } = sample()
    stub([])
    const screen = await mountPanel({
      canvas,
      selection: [...only(api), ...only(db)],
    })
    await expect.element(screen.getByText(/Select one element/)).toBeVisible()
    expect(screen.container.querySelector('textarea')).toBeNull()
  })

  it('shows a thread on a connection under the two names it joins', async () => {
    const { canvas, link } = sample()
    stub([thread('44444444-4444-4444-8444-444444444444', link, 'TLS here?')])
    const screen = await mountPanel({ canvas })
    await expect
      .element(screen.getByText('Backend Order → Database'))
      .toBeVisible()
  })

  it('selects the element a thread is about', async () => {
    const { canvas, api } = sample()
    stub([
      thread(
        '11111111-1111-4111-8111-111111111111',
        api,
        'Is this behind the gateway?'
      ),
    ])
    const onSelectElement = vi.fn()
    const screen = await mountPanel({ canvas, onSelectElement })
    await screen.getByRole('button', { name: 'Backend Order' }).click()
    expect(onSelectElement).toHaveBeenCalledWith(api)
  })

  it('mentions a person from the workspace, and shows a stored mention as a name', async () => {
    const { canvas, api } = sample()
    const fetch = stub([
      thread(
        '11111111-1111-4111-8111-111111111111',
        api,
        'cc @[Dewi Lestari](user:33333333-3333-4333-8333-333333333333) please'
      ),
    ])
    const screen = await mountPanel({ canvas, selection: only(api) })
    await expect.element(screen.getByText('@Dewi Lestari')).toBeVisible()
    const chip = screen.container.querySelector('[data-mention]')
    expect(chip?.textContent).toBe('@Dewi Lestari')
    expect(screen.container.textContent).not.toContain('user:')

    await screen.getByLabelText('New comment on Backend Order').click()
    await userEvent.keyboard('Thanks @dew')
    await screen.getByRole('option', { name: /Dewi Lestari/ }).click()
    await screen.getByRole('button', { name: 'Comment', exact: true }).click()
    await vi.waitFor(() =>
      expect(JSON.parse(String(posted(fetch)?.[1]?.body)).content).toBe(
        'Thanks @[Dewi Lestari](user:33333333-3333-4333-8333-333333333333)'
      )
    )
  })

  it('cannot be written by someone who may only view', async () => {
    const { canvas, api } = sample()
    stub([])
    const screen = await mountPanel({
      canvas,
      selection: only(api),
      canComment: false,
    })
    await expect.element(screen.getByText('No comments yet.')).toBeVisible()
    expect(screen.container.querySelector('textarea')).toBeNull()
  })

  it('counts the open threads on the tab, not the resolved ones', async () => {
    stub([
      thread('11111111-1111-4111-8111-111111111111', 'a', 'Open one'),
      thread('22222222-2222-4222-8222-222222222222', 'b', 'Open two'),
      thread('33333333-3333-4333-8333-333333333333', 'c', 'Done', true),
    ])
    const screen = await render(
      <QueryClientProvider client={client()}>
        <CommentsTabLabel workspaceID={workspaceID} documentID={documentID} />
      </QueryClientProvider>
    )
    await expect.element(screen.getByText('2')).toBeVisible()
  })
})
