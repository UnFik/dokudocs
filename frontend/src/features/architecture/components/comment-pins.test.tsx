import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import * as Y from 'yjs'
import { useAuthStore } from '@/stores/auth-store'
import { addSystem, readCanvas } from '../lib/canvas-doc'
import type { PinAnchor } from '../lib/comment-pins'
import { ArchitectureCanvas } from './architecture-canvas'
import { CommentPins } from './comment-pins'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const me = testSession().user.id
const someoneElse = '33333333-3333-4333-8333-333333333333'

const thread = (fields: {
  id: string
  elementId: string
  content: string
  authorId?: string
  authorName?: string
  resolved?: boolean
  replies?: number
  x?: number
  y?: number
}) => ({
  id: fields.id,
  documentId: documentID,
  authorId: fields.authorId ?? me,
  authorName: fields.authorName ?? 'Sari',
  selectedText: 'Cache',
  content: fields.content,
  anchor: {
    kind: 'element',
    elementId: fields.elementId,
    x: fields.x,
    y: fields.y,
  },
  createdAt: '2026-10-08T00:00:00Z',
  resolvedAt: fields.resolved ? '2026-10-08T01:00:00Z' : null,
  replies: Array.from({ length: fields.replies ?? 0 }, (_, i) => ({
    id: `4444444${i}-4444-4444-8444-444444444444`,
    threadId: fields.id,
    authorId: someoneElse,
    authorName: 'Rina',
    content: `Reply ${i + 1}`,
    createdAt: '2026-10-08T02:00:00Z',
  })),
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
    if (
      init?.method === 'POST' ||
      init?.method === 'DELETE' ||
      init?.method === 'PATCH'
    )
      return new Response(null, { status: 204 })
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

/** A canvas with one System, Cache, its threads made from Cache's id, and the pins on it. */
async function show(options: {
  threads?: (cache: string) => unknown[]
  showResolved?: boolean
  draft?: Omit<PinAnchor, 'elementId'>
}) {
  const doc = new Y.Doc()
  const cache = addSystem(doc, {
    catalog: 'redis',
    name: 'Cache',
    x: 100,
    y: 100,
    parentId: null,
  })
  const fetch = stub(options.threads?.(cache) ?? [])
  const onDraftDone = vi.fn()
  const draft = options.draft ? { ...options.draft, elementId: cache } : null
  await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ReactFlowProvider>
        <div style={{ width: 400, height: 500 }}>
          <ArchitectureCanvas
            doc={doc}
            canvas={readCanvas(doc)}
            catalog={[]}
            readOnly={false}
            canComment
            selection={[]}
            onSelect={vi.fn()}
            peers={[]}
            onPointer={vi.fn()}
            onConnected={vi.fn()}
            onAdd={vi.fn()}
            onDelete={vi.fn()}
            onUndo={vi.fn()}
            onRedo={vi.fn()}
            onGesture={vi.fn()}
            canAdd
          >
            <Pins
              doc={doc}
              showResolved={options.showResolved ?? false}
              draft={draft}
              onDraftDone={onDraftDone}
            />
          </ArchitectureCanvas>
        </div>
      </ReactFlowProvider>
    </QueryClientProvider>
  )
  return { cache, fetch, onDraftDone }
}

function Pins(props: {
  doc: Y.Doc
  showResolved: boolean
  draft: PinAnchor | null
  onDraftDone: () => void
}) {
  const [active, setActive] = useState<string | null>(null)
  return (
    <CommentPins
      workspaceID={workspaceID}
      documentID={documentID}
      userID={me}
      canvas={readCanvas(props.doc)}
      canComment
      showResolved={props.showResolved}
      draft={props.draft}
      onDraftDone={props.onDraftDone}
      active={active}
      onActive={setActive}
      onChanged={vi.fn()}
    />
  )
}

const pins = () => page.getByRole('button', { name: /^Comment by/ })
async function pin(name: RegExp = /^Comment by/) {
  const found = page.getByRole('button', { name }).first()
  await expect.element(found).toBeInTheDocument()
  return found.element() as HTMLElement
}

describe('comment pins on the canvas', () => {
  const open = (cache: string) =>
    thread({
      id: '11111111-1111-4111-8111-111111111111',
      elementId: cache,
      content: 'Is this behind the gateway?',
      x: 0.5,
      y: 0.5,
    })
  const resolved = (cache: string) =>
    thread({
      id: '22222222-2222-4222-8222-222222222222',
      elementId: cache,
      content: 'Done',
      resolved: true,
    })

  it('shows a pin where its thread points on the element, open threads only', async () => {
    await show({ threads: (cache) => [open(cache), resolved(cache)] })
    await expect.element(pins().first()).toBeVisible()
    expect(pins().elements()).toHaveLength(1)
    const at = pins().first().element().getBoundingClientRect()
    const node = document
      .querySelector('.react-flow__node')!
      .getBoundingClientRect()
    expect(
      Math.abs(at.x + at.width / 2 - (node.x + node.width / 2))
    ).toBeLessThan(4)
    expect(
      Math.abs(at.y + at.height / 2 - (node.y + node.height / 2))
    ).toBeLessThan(4)
  })

  it('shows resolved threads too when asked', async () => {
    await show({
      threads: (cache) => [open(cache), resolved(cache)],
      showResolved: true,
    })
    await vi.waitFor(() => expect(pins().elements()).toHaveLength(2))
  })
})

describe('a pin', () => {
  it('previews its thread on hover and opens it on Enter, with a reply box; Esc closes it', async () => {
    await show({
      threads: (cache) => [
        thread({
          id: '11111111-1111-4111-8111-111111111111',
          elementId: cache,
          content: 'Is this behind the gateway?\nSecond line\nThird line',
          replies: 2,
          x: 0.5,
          y: 0.5,
        }),
      ],
    })
    await expect
      .element(pins().first())
      .toHaveAccessibleName(/Comment by Sari, 2 replies/)
    await userEvent.hover(await pin())
    const preview = page.getByRole('tooltip')
    await expect.element(preview).toHaveTextContent(/Sari/)
    await expect
      .element(preview)
      .toHaveTextContent(/Is this behind the gateway\?/)
    await expect.element(preview).toHaveTextContent(/2 replies/)
    expect(preview.element().textContent).not.toMatch(/Third line/)

    await userEvent.unhover(await pin())
    // Keyboard: a pin is a button in the tab order.
    ;(await pin()).focus()
    await userEvent.keyboard('{Enter}')
    const dialog = page.getByRole('dialog', { name: /Comment by Sari/ })
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog.getByText('Reply 2')).toBeVisible()
    await expect
      .element(dialog.getByRole('textbox', { name: /Reply to Sari/ }))
      .toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
  })

  it('lets the author edit or delete their own comment, and nobody else', async () => {
    const { fetch } = await show({
      threads: (cache) => [
        thread({
          id: '11111111-1111-4111-8111-111111111111',
          elementId: cache,
          content: 'Mine',
          replies: 1,
          x: 0.2,
          y: 0.5,
        }),
        thread({
          id: '22222222-2222-4222-8222-222222222222',
          elementId: cache,
          content: 'Theirs',
          authorId: someoneElse,
          authorName: 'Rina',
          x: 0.8,
          y: 0.5,
        }),
      ],
    })
    ;(await pin(/^Comment by Rina/)).focus()
    await userEvent.keyboard('{Enter}')
    const theirs = page.getByRole('dialog')
    await expect.element(theirs.getByText('Theirs')).toBeVisible()
    expect(
      theirs.getByRole('button', { name: /Delete/ }).elements()
    ).toHaveLength(0)
    await userEvent.keyboard('{Escape}')
    ;(await pin(/^Comment by Sari/)).focus()
    await userEvent.keyboard('{Enter}')
    const mine = page.getByRole('dialog')
    // Only the thread is mine; Rina's reply in it is not.
    expect(
      mine.getByRole('button', { name: 'Delete comment' }).elements()
    ).toHaveLength(1)
    expect(
      mine.getByRole('button', { name: 'Delete reply' }).elements()
    ).toHaveLength(0)
    await userEvent.click(mine.getByRole('button', { name: 'Delete comment' }))
    // It asks first, since the replies go with it.
    await expect
      .element(mine.getByText('Delete this comment and its replies?'))
      .toBeVisible()
    await userEvent.click(mine.getByRole('button', { name: 'Yes, delete' }))
    await vi.waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([url, init]) =>
            init?.method === 'DELETE' &&
            String(url).endsWith(
              '/comments/11111111-1111-4111-8111-111111111111'
            )
        )
      ).toBe(true)
    )
  })
})

describe('a new thread', () => {
  it('starts where the element was clicked and is saved with that point', async () => {
    const { cache, fetch, onDraftDone } = await show({
      draft: { kind: 'element', x: 0.25, y: 0.5 },
    })
    const box = page.getByRole('textbox', { name: 'New comment on Cache' })
    await expect.element(box).toHaveFocus()
    await userEvent.fill(box, 'Does this need a replica?')
    await userEvent.click(
      page
        .getByRole('dialog', { name: 'New comment on Cache' })
        .getByRole('button', { name: 'Comment', exact: true })
    )
    await vi.waitFor(() => {
      const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
      expect(post).toBeDefined()
      expect(JSON.parse(String(post![1]!.body))).toMatchObject({
        content: 'Does this need a replica?',
        selectedText: 'Cache',
        anchor: { kind: 'element', elementId: cache, x: 0.25, y: 0.5 },
      })
    })
    await vi.waitFor(() => expect(onDraftDone).toHaveBeenCalled())
  })
})
