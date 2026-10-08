import { describe, expect, it } from 'vitest'
import { cardTitle, suggestionCards } from './suggestionCards'
import {
  documentOf,
  ME,
  OTHER,
  paragraph,
  run,
  stateOf,
  type Piece,
} from './suggestionTestKit'

const A = '00000000-0000-4000-8000-000000000401'
const B = '00000000-0000-4000-8000-000000000402'
const C = '00000000-0000-4000-8000-000000000403'

function cardsOf(...pieces: Piece[][]) {
  const doc = documentOf(
    ...pieces.map((runPieces, index) =>
      paragraph(`p${index}`, [run(`r${index}`, runPieces)])
    )
  )
  return suggestionCards(stateOf(doc).doc)
}

describe('suggestion cards', () => {
  it('names a card from what it contains: Add, Delete, or Replace', () => {
    const cards = cardsOf([
      'one ',
      { text: 'added', mark: 'insert', id: A },
      ' two ',
      { text: 'removed', mark: 'delete', id: B },
      ' three ',
      { text: 'old', mark: 'delete', id: C },
      { text: 'new', mark: 'insert', id: C },
    ])

    expect(cards.map(cardTitle)).toEqual([
      'Add: "added"',
      'Delete: "removed"',
      'Replace: "old" with "new"',
    ])
  })

  it('lists cards in document order with their author', () => {
    const cards = cardsOf(
      [{ text: 'later', mark: 'insert', by: OTHER, id: B }],
      [{ text: 'earlier', mark: 'insert', by: ME, id: A }]
    )

    expect(cards.map((card) => [card.id, card.author])).toEqual([
      [B, OTHER],
      [A, ME],
    ])
  })

  it('joins the pieces of one suggestion that sit in different runs', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [{ text: 'foo', mark: 'insert', id: A }]),
        run('r2', ['plain']),
        run('r3', [{ text: 'bar', mark: 'insert', id: A }]),
      ])
    )

    const [card] = suggestionCards(stateOf(doc).doc)

    expect(cardTitle(card!)).toBe('Add: "foobar"')
  })

  it('shortens a long text in the title', () => {
    const [card] = cardsOf([{ text: 'x'.repeat(80), mark: 'insert', id: A }])

    expect(cardTitle(card!)).toBe(`Add: "${'x'.repeat(40)}…"`)
  })

  it('has no cards for a body without suggestions', () => {
    expect(cardsOf(['just text'])).toEqual([])
  })
})
