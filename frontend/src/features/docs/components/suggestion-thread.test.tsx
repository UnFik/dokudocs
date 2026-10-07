import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { DocumentSuggestion } from '@/lib/domain-api'
import { SuggestionThread } from './suggestion-thread'

// The component talks to the API through fetch, so the requests are what is asserted.
const requests: { url: string; method: string; body: unknown }[] = []
beforeEach(() => {
  requests.length = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    requests.push({
      url: new URL(String(input)).pathname,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(null, { status: 204 })
  })
})

const ME = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const SUGGESTION = '00000000-0000-4000-8000-0000000000aa'

function suggestion(
  over: Partial<DocumentSuggestion> = {}
): DocumentSuggestion {
  return {
    documentId: '00000000-0000-4000-8000-0000000000dd',
    suggestionId: SUGGESTION,
    proposerId: OTHER,
    conflictReason: '',
    status: 'pending',
    createdAt: '2026-10-02T10:00:00Z',
    replies: [
      {
        replyId: '00000000-0000-4000-8000-0000000000b1',
        suggestionId: SUGGESTION,
        authorId: OTHER,
        body: 'Why this change?',
        createdAt: '2026-10-02T10:01:00Z',
      },
      {
        replyId: '00000000-0000-4000-8000-0000000000b2',
        suggestionId: SUGGESTION,
        authorId: ME,
        body: 'The title lacked punctuation.',
        createdAt: '2026-10-02T10:02:00Z',
      },
    ],
    ...over,
    proposerName: over.proposerName ?? 'Suggestion author',
  }
}

function renderThread(item: DocumentSuggestion) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SuggestionThread
        suggestion={item}
        workspaceID='w'
        documentID='d'
        userID={ME}
      />
    </QueryClientProvider>
  )
}

describe('SuggestionThread', () => {
  it('lists replies oldest first, signed You or by role', async () => {
    const { getByText } = await renderThread(suggestion())
    await expect.element(getByText('Why this change?')).toBeInTheDocument()
    await expect.element(getByText('Proposer')).toBeInTheDocument()
    await expect.element(getByText('You')).toBeInTheDocument()
  })

  it('sends a trimmed reply and keeps Send disabled while it is empty', async () => {
    const { getByRole, getByLabelText } = await renderThread(suggestion())
    // The box only appears once Reply is pressed.
    await expect.element(getByLabelText('Reply')).not.toBeInTheDocument()
    await userEvent.click(getByRole('button', { name: 'Reply' }))
    const send = getByRole('button', { name: 'Send reply' })
    await expect.element(send).toBeDisabled()
    await userEvent.fill(getByLabelText('Reply'), '  Agreed.  ')
    await userEvent.click(send)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({
      url: `/api/v1/documents/d/suggestions/${SUGGESTION}/replies`,
      method: 'POST',
      body: { replyID: expect.any(String), body: 'Agreed.' },
    })
  })

  it('blocks a reply that is too long and says by how much', async () => {
    const { getByRole, getByLabelText } = await renderThread(suggestion())
    await userEvent.click(getByRole('button', { name: 'Reply' }))
    await userEvent.fill(getByLabelText('Reply'), 'x'.repeat(2003))
    await expect.element(getByRole('alert')).toHaveTextContent('Cut 3')
    await expect
      .element(getByRole('button', { name: 'Send reply' }))
      .toBeDisabled()
  })

  it('resolves the discussion without any decision on the suggestion', async () => {
    const { getByRole } = await renderThread(suggestion())
    await userEvent.click(getByRole('button', { name: 'Resolve discussion' }))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      url: `/api/v1/documents/d/suggestions/${SUGGESTION}/resolve`,
      method: 'POST',
    })
  })

  it('collapses a resolved discussion, hides the form, and reopens it', async () => {
    const { getByRole, getByText, getByLabelText } = await renderThread(
      suggestion({ resolvedAt: '2026-10-02T11:00:00Z' })
    )
    await expect.element(getByText('Resolved')).toBeInTheDocument()
    await expect.element(getByText('Why this change?')).not.toBeInTheDocument()
    await expect.element(getByLabelText('Reply')).not.toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: 'Show 2 replies' }))
    await expect.element(getByText('Why this change?')).toBeInTheDocument()

    await userEvent.click(getByRole('button', { name: 'Reopen discussion' }))
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      url: `/api/v1/documents/d/suggestions/${SUGGESTION}/reopen`,
      method: 'POST',
    })
  })
})
