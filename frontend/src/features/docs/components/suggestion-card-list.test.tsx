import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { CommentThread } from '@/lib/domain-api'
import type { SuggestionCard } from '../lib/prosemirror/suggestionCards'
import { SuggestionCardList } from './suggestion-card-list'

const ME = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000a2'

const cards: SuggestionCard[] = [
  {
    id: 'mine',
    author: ME,
    inserted: 'new',
    deleted: 'old',
    formatted: '',
    formats: [],
    insertedBlocks: 0,
    deletedBlocks: 0,
    blockKinds: [],
    deletedKinds: [],
    position: 1,
  },
  {
    id: 'theirs',
    author: OTHER,
    inserted: '',
    deleted: 'gone',
    formatted: '',
    formats: [],
    insertedBlocks: 0,
    deletedBlocks: 0,
    blockKinds: [],
    deletedKinds: [],
    position: 9,
  },
]

async function renderList(
  over: Partial<Parameters<typeof SuggestionCardList>[0]> = {}
) {
  const onDecide = vi.fn()
  const result = await render(
    <SuggestionCardList
      cards={cards}
      userID={ME}
      canDecide
      disabled={false}
      onDecide={onDecide}
      onSelect={vi.fn()}
      focusedSuggestionID={null}
      discussions={[]}
      canInteract
      workspaceID='workspace'
      documentID='document'
      {...over}
    />
  )
  return { ...result, onDecide }
}

describe('SuggestionCardList', () => {
  it('titles each card from what it contains and says whose it is', async () => {
    const { getByText } = await renderList()

    await expect
      .element(getByText('Replace: "old" with "new"'))
      .toBeInTheDocument()
    await expect.element(getByText('Delete: "gone"')).toBeInTheDocument()
    await expect.element(getByText('You')).toBeInTheDocument()
    await expect.element(getByText('Collaborator')).toBeInTheDocument()
  })

  it('lets an editor accept or reject any card', async () => {
    const { getByRole, onDecide } = await renderList()

    await userEvent.click(getByRole('button', { name: 'Accept' }).first())
    await userEvent.click(getByRole('button', { name: 'Reject' }).nth(1))

    expect(onDecide.mock.calls).toEqual([
      ['mine', 'accept'],
      ['theirs', 'reject'],
    ])
  })

  it('lets someone who cannot edit only withdraw their own suggestion', async () => {
    const { getByRole, onDecide } = await renderList({ canDecide: false })

    await expect
      .element(getByRole('button', { name: 'Accept' }))
      .not.toBeInTheDocument()
    await expect
      .element(getByRole('button', { name: 'Withdraw' }))
      .toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: 'Withdraw' }))

    expect(onDecide.mock.calls).toEqual([['mine', 'reject']])
  })

  it('disables deciding in View mode and says why', async () => {
    const { getByRole, getByText } = await renderList({ disabled: true })

    await expect
      .element(getByRole('button', { name: 'Accept' }).first())
      .toBeDisabled()
    await expect
      .element(
        getByText(
          'Switch to Edit or Suggest mode to accept, reject, or withdraw.'
        )
      )
      .toBeInTheDocument()
  })

  it('says how to start when there are no suggestions and no comments', async () => {
    const { getByText } = await renderList({ cards: [] })

    await expect
      .element(getByText(/No suggestions or comments yet/))
      .toBeInTheDocument()
  })
})

const thread = (
  id: string,
  content: string,
  extra: Partial<CommentThread> = {}
): CommentThread => ({
  id,
  documentId: 'document',
  authorId: OTHER,
  authorName: 'Dewi Lestari',
  selectedText: `quote of ${content}`,
  content,
  anchor: null,
  createdAt: '2026-10-03T00:00:00Z',
  resolvedAt: null,
  resolvedBy: null,
  replies: [],
  ...extra,
})

async function renderWithComments(
  over: Partial<Parameters<typeof SuggestionCardList>[0]> = {}
) {
  const client = new QueryClient()
  const onSelectComment = vi.fn()
  const result = await render(
    <QueryClientProvider client={client}>
      <SuggestionCardList
        cards={cards}
        userID={ME}
        canDecide
        disabled={false}
        onDecide={vi.fn()}
        onSelect={vi.fn()}
        focusedSuggestionID={null}
        discussions={[]}
        canInteract
        workspaceID='workspace'
        documentID='document'
        onSelectComment={onSelectComment}
        {...over}
      />
    </QueryClientProvider>
  )
  return { ...result, onSelectComment }
}

const order = (container: Element) =>
  [
    ...container.querySelectorAll(
      'ul[aria-label="Suggestions and comments"] > li'
    ),
  ].map((item) =>
    item.getAttribute('data-comment-thread-id')
      ? `comment:${item.getAttribute('data-comment-thread-id')}`
      : item.hasAttribute('data-new-comment')
        ? 'new'
        : `suggestion:${item.getAttribute('data-suggestion-id')}`
  )

describe('SuggestionCardList with comments', () => {
  it('lists suggestions and comments in document order, with threads whose text is gone last', async () => {
    const { container } = await renderWithComments({
      comments: [
        thread('lost', 'text was deleted'),
        thread('late', 'near the end'),
        thread('early', 'near the start'),
      ],
      commentPositions: { early: 0, late: 20, lost: null },
    })

    expect(order(container)).toEqual([
      'comment:early',
      'suggestion:mine',
      'suggestion:theirs',
      'comment:late',
      'comment:lost',
    ])
  })

  it('labels a thread whose text changed, and still shows its quote', async () => {
    const { getByText } = await renderWithComments({
      comments: [thread('lost', 'text was deleted')],
      commentPositions: { lost: null },
    })

    await expect.element(getByText('text changed')).toBeInTheDocument()
    await expect
      .element(getByText('quote of text was deleted'))
      .toBeInTheDocument()
  })

  it('hides resolved threads behind one control that shows them', async () => {
    const { container, getByRole } = await renderWithComments({
      cards: [],
      comments: [
        thread('open', 'still open'),
        thread('done', 'settled', { resolvedAt: '2026-10-03T01:00:00Z' }),
      ],
      commentPositions: { open: 1, done: 2 },
    })

    expect(order(container)).toEqual(['comment:open'])
    await userEvent.click(
      getByRole('button', { name: 'Show 1 resolved comment' })
    )
    expect(order(container)).toEqual(['comment:open', 'comment:done'])
    await expect
      .element(getByRole('button', { name: 'Hide resolved comments' }))
      .toBeInTheDocument()
  })

  it('says comments are loading while they load', async () => {
    const { getByText } = await renderWithComments({
      cards: [],
      commentsLoading: true,
    })

    await expect.element(getByText('Loading comments...')).toBeInTheDocument()
  })

  it('says so when every comment is resolved, and renders no empty list', async () => {
    const { container, getByText } = await renderWithComments({
      cards: [],
      comments: [
        thread('done', 'settled', { resolvedAt: '2026-10-03T01:00:00Z' }),
      ],
      commentPositions: { done: 2 },
    })

    await expect
      .element(getByText('Every comment is resolved.'))
      .toBeInTheDocument()
    expect(
      container.querySelector('ul[aria-label="Suggestions and comments"]')
    ).toBeNull()
  })

  it('shows the comment being written first, and asks the list to focus a thread on click', async () => {
    const { container, getByRole, onSelectComment } = await renderWithComments({
      comments: [thread('t1', 'a question')],
      commentPositions: { t1: 3 },
      newComment: {
        selectedText: 'quoted words',
        anchor: { nodeID: 'n', start: 'AA==', end: 'AQ==' },
      },
    })

    expect(order(container)[0]).toBe('new')
    await userEvent.click(
      getByRole('button', { name: 'Show in document: quote of a question' })
    )
    expect(onSelectComment).toHaveBeenCalledWith('t1')
  })

  it('does not offer replies or resolve to someone who cannot comment', async () => {
    const { getByRole } = await renderWithComments({
      cards: [],
      canInteract: false,
      comments: [thread('t1', 'a question')],
      commentPositions: { t1: 3 },
    })

    expect(
      getByRole('button', { name: 'Resolve comment' }).elements()
    ).toHaveLength(0)
    expect(getByRole('button', { name: 'Send reply' }).elements()).toHaveLength(
      0
    )
  })
})

describe('editing and deleting comments', () => {
  const mine = thread('mine', 'my question', {
    authorId: ME,
    authorName: 'Me',
    replies: [
      {
        id: '00000000-0000-4000-8000-0000000000b1',
        threadId: 'mine',
        authorId: OTHER,
        authorName: 'Dewi Lestari',
        content: 'their answer',
        createdAt: '2026-10-03T00:00:00Z',
        editedAt: '2026-10-03T00:05:00Z',
      },
    ],
  })
  const theirs = thread('theirs', 'their question')
  const positions = { mine: 1, theirs: 2 }

  it('lets the author edit and delete their own comment, and shows when a reply was edited', async () => {
    const { getByRole, getByText } = await renderWithComments({
      cards: [],
      canDecide: false,
      comments: [mine],
      commentPositions: positions,
    })

    await expect
      .element(getByRole('button', { name: 'Edit', exact: true }))
      .toBeInTheDocument()
    await expect
      .element(getByRole('button', { name: 'Delete', exact: true }))
      .toBeInTheDocument()
    // The reply is someone else's: no edit or delete for an author of the thread.
    expect(getByRole('button', { name: 'Edit reply' }).elements()).toHaveLength(
      0
    )
    expect(
      getByRole('button', { name: 'Delete reply' }).elements()
    ).toHaveLength(0)
    await expect.element(getByText('edited')).toBeInTheDocument()
  })

  it("offers an editor Delete on anyone's comment, but Edit only on their own", async () => {
    const { getByRole } = await renderWithComments({
      cards: [],
      canDecide: true,
      comments: [theirs],
      commentPositions: positions,
    })

    await expect
      .element(getByRole('button', { name: 'Delete', exact: true }))
      .toBeInTheDocument()
    expect(
      getByRole('button', { name: 'Edit', exact: true }).elements()
    ).toHaveLength(0)
  })

  it('offers someone else, and someone who cannot comment, neither', async () => {
    const other = await renderWithComments({
      cards: [],
      canDecide: false,
      comments: [theirs],
      commentPositions: positions,
    })
    expect(
      other.getByRole('button', { name: 'Delete', exact: true }).elements()
    ).toHaveLength(0)
    await other.unmount()

    const readOnly = await renderWithComments({
      cards: [],
      canInteract: false,
      canDecide: true,
      comments: [mine],
      commentPositions: positions,
    })
    expect(
      readOnly.getByRole('button', { name: 'Edit', exact: true }).elements()
    ).toHaveLength(0)
    expect(
      readOnly.getByRole('button', { name: 'Delete', exact: true }).elements()
    ).toHaveLength(0)
  })

  it('edit opens a form with the current text, and Cancel puts the comment back', async () => {
    const { getByRole, getByLabelText } = await renderWithComments({
      cards: [],
      comments: [mine],
      commentPositions: positions,
    })

    await userEvent.click(getByRole('button', { name: 'Edit', exact: true }))
    await expect
      .element(getByLabelText('Edit comment'))
      .toHaveValue('my question')
    await userEvent.click(getByRole('button', { name: 'Cancel' }))
    expect(getByLabelText('Edit comment').elements()).toHaveLength(0)
  })

  it('delete asks first and names what goes with it', async () => {
    const { getByRole, getByText } = await renderWithComments({
      cards: [],
      comments: [mine],
      commentPositions: positions,
    })

    await userEvent.click(getByRole('button', { name: 'Delete', exact: true }))
    await expect.element(getByText('Delete this comment?')).toBeInTheDocument()
    await expect
      .element(getByText(/its 1 reply is removed|and its 1 reply are removed/))
      .toBeInTheDocument()
  })
})
