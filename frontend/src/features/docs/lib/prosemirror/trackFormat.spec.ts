import { TextSelection, type EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { decideSuggestion } from './decideSuggestion'
import { prosemirrorToDocumentBody } from './documentBody'
import { cardTitle, suggestionCards } from './suggestionCards'
import {
  documentOf,
  ME,
  OTHER,
  paragraph,
  positionIn,
  run,
  stateOf,
} from './suggestionTestKit'
import { UnsupportedSuggestionError } from './trackChanges'
import { suggestFormat } from './trackFormat'

let counter = 0
const options = {
  author: ME,
  newID: () =>
    `00000000-0000-4000-8000-0000000009${String(counter++).padStart(2, '0')}`,
}

function select(state: EditorState, needle: string, from: number, to: number) {
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(
        state.doc,
        positionIn(state.doc, needle, from),
        positionIn(state.doc, needle, to)
      )
    )
  )
}

const hello = () =>
  stateOf(documentOf(paragraph('p1', [run('r1', ['hello world'])])))

const boldRuns = (state: EditorState) =>
  prosemirrorToDocumentBody(state.doc)
    .filter((row) => row.type === 'run')
    .map((row) => row.attributes)

describe('formatting a selection in Suggest mode', () => {
  it('proposes bold and leaves the text as it is', () => {
    let state = select(hello(), 'hello', 0, 5)

    state = state.apply(suggestFormat(state, 'strong', options))

    const [card] = suggestionCards(state.doc)
    expect(cardTitle(card!)).toBe('Format: bold "hello"')
    let strong = false
    state.doc.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === 'strong')) strong = true
    })
    expect(strong).toBe(false)
    // The canonical body does not see the proposal.
    expect(JSON.stringify(boldRuns(state))).not.toContain('suggestion')
  })

  it('accepting makes the text bold and rejecting leaves it alone', () => {
    let state = select(hello(), 'hello', 0, 5)
    state = state.apply(suggestFormat(state, 'strong', options))
    const id = suggestionCards(state.doc)[0]!.id

    const accepted = state.apply(
      decideSuggestion(state, id, 'accept').transaction
    )
    const boldText: string[] = []
    accepted.doc.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === 'strong'))
        boldText.push(node.text ?? '')
    })
    expect(boldText).toEqual(['hello'])
    expect(suggestionCards(accepted.doc)).toEqual([])

    const rejected = state.apply(
      decideSuggestion(state, id, 'reject').transaction
    )
    expect(suggestionCards(rejected.doc)).toEqual([])
    let strong = false
    rejected.doc.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === 'strong')) strong = true
    })
    expect(strong).toBe(false)
  })

  it('a second format on the same text joins the same suggestion', () => {
    let state = select(hello(), 'hello', 0, 5)
    state = state.apply(suggestFormat(state, 'strong', options))
    state = select(state, 'hello', 0, 5)

    state = state.apply(suggestFormat(state, 'em', options))

    const cards = suggestionCards(state.doc)
    expect(cards).toHaveLength(1)
    expect(cardTitle(cards[0]!)).toBe('Format: bold, italic "hello"')
  })

  it('toggling again takes the proposal back', () => {
    let state = select(hello(), 'hello', 0, 5)
    state = state.apply(suggestFormat(state, 'strong', options))
    state = select(state, 'hello', 0, 5)

    state = state.apply(suggestFormat(state, 'strong', options))

    expect(suggestionCards(state.doc)).toEqual([])
  })

  it('proposes removing a format the text already has', () => {
    const doc = documentOf(
      paragraph('p1', [run('r1', [{ text: 'bold', bold: true }])])
    )
    let state = select(stateOf(doc), 'bold', 0, 4)

    state = state.apply(suggestFormat(state, 'strong', options))

    expect(cardTitle(suggestionCards(state.doc)[0]!)).toBe(
      'Format: remove bold "bold"'
    )
  })

  it('formats your own inserted text for real', () => {
    const doc = documentOf(
      paragraph('p1', [run('r1', [{ text: 'new', mark: 'insert', by: ME }])])
    )
    let state = select(stateOf(doc), 'new', 0, 3)

    state = state.apply(suggestFormat(state, 'strong', options))

    const marksFound: string[] = []
    state.doc.descendants((node) => {
      for (const mark of node.marks) marksFound.push(mark.type.name)
    })
    expect(marksFound).toContain('strong')
    expect(marksFound).not.toContain('suggestion_format')
  })

  it("refuses text under someone else's suggestion", () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [{ text: 'theirs', mark: 'insert', by: OTHER }]),
      ])
    )
    const state = select(stateOf(doc), 'theirs', 0, 6)

    expect(() => suggestFormat(state, 'strong', options)).toThrow(
      UnsupportedSuggestionError
    )
  })
})
