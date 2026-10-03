import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { SuggestionCard } from '../lib/prosemirror/suggestionCards'
import { SuggestionCardList } from './suggestion-card-list'

const ME = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000a2'

const cards: SuggestionCard[] = [
  { id: 'mine', author: ME, inserted: 'new', deleted: 'old', position: 1 },
  { id: 'theirs', author: OTHER, inserted: '', deleted: 'gone', position: 9 },
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

  it('says how to make a suggestion when there are none', async () => {
    const { getByText } = await renderList({ cards: [] })

    await expect
      .element(
        getByText(
          'No suggestions in this document. In Suggest mode, what you type becomes one.'
        )
      )
      .toBeInTheDocument()
  })
})
