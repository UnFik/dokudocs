import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { jsonResponse, testSession } from '@/test-utils/auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import type { CommentThread } from '@/lib/domain-api'
import { SourceCommentsPanel } from './source-comments-panel'

const workspaceID = '149a8d07-8490-43ed-98fa-ebaa91b05e90'
const documentID = 'b1f973dd-b554-4540-95c0-4697726ad6e1'
const me = testSession().user.id

const thread = (
  id: string,
  content: string,
  over: Partial<CommentThread> = {}
): CommentThread =>
  ({
    id,
    documentId: documentID,
    authorId: me,
    authorName: 'Sari',
    selectedText: 'users',
    content,
    anchor: null,
    sourceAnchor: { kind: 'source', start: 'AA==', end: 'AQ==' },
    createdAt: '2026-10-10T00:00:00Z',
    replies: [],
    ...over,
  }) as CommentThread

beforeEach(() => useAuthStore.getState().auth.setSession(testSession()))
afterEach(() => {
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

async function mount(
  props: Partial<React.ComponentProps<typeof SourceCommentsPanel>> = {}
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (new URL(String(input)).pathname.endsWith('/mentionable'))
        return jsonResponse([])
      return new Response(null, { status: 201 })
    })
  )
  const handlers = {
    onSelect: vi.fn(),
    onStartDraft: vi.fn(),
    onDraftDone: vi.fn(),
  }
  const screen = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SourceCommentsPanel
        workspaceID={workspaceID}
        documentID={documentID}
        userID={me}
        threads={[]}
        ranges={new Map()}
        loading={false}
        failed={false}
        canComment
        canDecide
        hasSelection
        draft={null}
        focusedID={null}
        {...handlers}
        {...props}
      />
    </QueryClientProvider>
  )
  return { screen, ...handlers }
}

describe('SourceCommentsPanel', () => {
  it('says what to do when there are no comments yet', async () => {
    const { screen } = await mount()
    await expect.element(screen.getByText(/No comments yet/)).toBeVisible()
    await expect.element(screen.getByText(/Select some source/)).toBeVisible()
  })

  it('lists open threads in the order of their words, and marks one whose words are gone', async () => {
    const ranges = new Map([
      [A, { from: 40, to: 45 }],
      [B, { from: 5, to: 10 }],
      [C, null],
    ])
    const { screen } = await mount({
      threads: [
        thread(A, 'second in the file'),
        thread(B, 'first in the file'),
        thread(C, 'words deleted'),
      ],
      ranges,
    })
    const items = Array.from(
      screen.container.querySelectorAll('li[data-comment-thread-id]')
    )
    expect(
      items.map((item) => item.getAttribute('data-comment-thread-id'))
    ).toEqual([B, A, C])
    await expect.element(screen.getByText('text changed')).toBeVisible()
  })

  it('keeps resolved threads out of sight until asked', async () => {
    const { screen } = await mount({
      threads: [
        thread(A, 'open one'),
        thread(B, 'done one', { resolvedAt: '2026-10-10T01:00:00Z' }),
      ],
      ranges: new Map([[A, { from: 1, to: 2 }]]),
    })
    await expect.element(screen.getByText('open one')).toBeVisible()
    expect(screen.container.textContent).not.toContain('done one')
    await screen
      .getByRole('button', { name: 'Show 1 resolved comment' })
      .click()
    await expect.element(screen.getByText('done one')).toBeVisible()
  })

  it('starts a comment on the selection', async () => {
    const withSelection = await mount()
    await withSelection.screen
      .getByRole('button', { name: 'Comment on selection' })
      .click()
    expect(withSelection.onStartDraft).toHaveBeenCalledOnce()
  })

  it('cannot start one with nothing selected', async () => {
    const none = await mount({ hasSelection: false })
    await expect
      .element(
        none.screen.getByRole('button', { name: 'Comment on selection' })
      )
      .toBeDisabled()
  })

  it('cannot start a comment for someone who may only read', async () => {
    const { screen } = await mount({ canComment: false })
    expect(
      screen.container.querySelector('button')?.textContent ?? ''
    ).not.toContain('Comment on selection')
    await expect
      .element(screen.getByText(/You can read comments/))
      .toBeVisible()
  })

  it('shows the comment being written, with the words it is on', async () => {
    const { screen } = await mount({
      draft: {
        selectedText: 'users',
        anchor: { kind: 'source', start: 'AA==', end: 'AQ==' },
      },
    })
    await expect.element(screen.getByText('users')).toBeVisible()
    await expect
      .element(screen.getByLabelText('Comment', { exact: true }))
      .toBeVisible()
  })

  it('says so when comments are loading or cannot be loaded', async () => {
    const loading = await mount({ loading: true })
    await expect
      .element(loading.screen.getByText(/Loading comments/))
      .toBeVisible()
    const failed = await mount({ failed: true })
    await expect
      .element(failed.screen.getByText(/Could not load comments/))
      .toBeVisible()
  })
})
