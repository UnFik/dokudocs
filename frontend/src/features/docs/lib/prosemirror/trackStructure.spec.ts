import { TextSelection, type EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { decideSuggestion } from './decideSuggestion'
import { prosemirrorToDocumentBody } from './documentBody'
import { cardTitle, suggestionCards } from './suggestionCards'
import {
  canonicalRuns,
  documentOf,
  ME,
  paragraph,
  positionIn,
  run,
  stateOf,
} from './suggestionTestKit'
import { suggestReplace, UnsupportedSuggestionError } from './trackChanges'
import { suggestEnter, suggestPasteLines } from './trackStructure'

let counter = 0
const options = {
  author: ME,
  newID: () =>
    `00000000-0000-4000-8000-0000000008${String(counter++).padStart(2, '0')}`,
}

function caretAt(state: EditorState, needle: string, offset: number) {
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, positionIn(state.doc, needle, offset))
    )
  )
}

const twoParagraphs = () =>
  stateOf(
    documentOf(
      paragraph('p1', [run('r1', ['first'])]),
      paragraph('p2', [run('r2', ['second'])])
    )
  )

const paragraphCount = (state: EditorState) =>
  prosemirrorToDocumentBody(state.doc).filter((row) => row.type === 'paragraph')
    .length

describe('Enter in Suggest mode', () => {
  it('adds an empty paragraph after the caret paragraph, as a suggestion the canonical body does not see', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)

    state = state.apply(suggestEnter(state, options))

    expect(paragraphCount(state)).toBe(2)
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])
    const cards = suggestionCards(state.doc)
    expect(cards.map(cardTitle)).toEqual(['Add: new paragraph'])
    expect(state.selection.$from.parent.type.name).toBe('paragraph')
    expect(state.selection.$from.parent.content.size).toBe(0)
  })

  it('puts what is typed next into the same suggestion', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)
    state = state.apply(suggestEnter(state, options))

    state = state.apply(
      suggestReplace(
        state,
        state.selection.from,
        state.selection.to,
        'typed',
        options
      )
    )

    const cards = suggestionCards(state.doc)
    expect(cards.map(cardTitle)).toEqual(['Add: "typed"'])
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])

    // Rejecting takes the paragraph and the text in it, nothing else.
    const rejected = state.apply(
      decideSuggestion(state, cards[0]!.id, 'reject').transaction
    )
    expect(rejected.doc.textContent).toBe('firstsecond')
    expect(paragraphCount(rejected)).toBe(2)
  })

  it('keeps pressing Enter in your own new paragraph in the same suggestion', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)
    state = state.apply(suggestEnter(state, options))
    state = state.apply(suggestEnter(state, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Add: 2 new paragraphs',
    ])
  })

  it('rejecting removes the new paragraph; accepting makes it part of the body', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)
    state = state.apply(suggestEnter(state, options))
    const id = suggestionCards(state.doc)[0]!.id

    const rejected = state.apply(
      decideSuggestion(state, id, 'reject').transaction
    )
    expect(paragraphCount(rejected)).toBe(2)
    expect(suggestionCards(rejected.doc)).toEqual([])
    expect(rejected.doc.textContent).toBe('firstsecond')

    const accepted = state.apply(
      decideSuggestion(state, id, 'accept').transaction
    )
    expect(suggestionCards(accepted.doc)).toEqual([])
    expect(paragraphCount(accepted)).toBe(3)
  })

  it('at the start of a paragraph with text adds the paragraph before it', () => {
    let state = caretAt(twoParagraphs(), 'second', 0)

    state = state.apply(suggestEnter(state, options))

    expect(paragraphCount(state)).toBe(2)
    expect(state.doc.child(0).child(1).textContent).toBe('')
    expect(state.doc.child(0).child(2).textContent).toBe('second')
  })

  it('refuses a split in the middle of text and changes nothing', () => {
    const state = caretAt(twoParagraphs(), 'first', 2)

    expect(() => suggestEnter(state, options)).toThrow(
      UnsupportedSuggestionError
    )
  })
})

describe('pasting lines in Suggest mode', () => {
  it('at the end of a paragraph is one suggestion: the first line as text, the rest as new paragraphs', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)

    state = state.apply(suggestPasteLines(state, ' A\nB\n\nC', options))

    expect(suggestionCards(state.doc)).toHaveLength(1)
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])
    expect(paragraphCount(state)).toBe(2)
    const paragraphs = state.doc.child(0)
    expect(
      [...Array(paragraphs.childCount).keys()].map(
        (index) => paragraphs.child(index).textContent
      )
    ).toEqual(['first A', 'B', '', 'C', 'second'])
  })

  it('refuses in the middle of a paragraph', () => {
    const state = caretAt(twoParagraphs(), 'first', 2)

    expect(() => suggestPasteLines(state, 'a\nb', options)).toThrow(
      UnsupportedSuggestionError
    )
  })
})
