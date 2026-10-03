import { TextSelection, type EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { decideSuggestion } from './decideSuggestion'
import { prosemirrorToDocumentBody } from './documentBody'
import { cardTitle, suggestionCards } from './suggestionCards'
import {
  canonicalRuns,
  documentOf,
  ME,
  OTHER,
  paragraph,
  positionIn,
  run,
  stateOf,
} from './suggestionTestKit'
import { suggestReplace, UnsupportedSuggestionError } from './trackChanges'
import {
  joinTarget,
  suggestEnter,
  suggestJoin,
  suggestPasteLines,
} from './trackStructure'

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

const paragraphTexts = (state: EditorState) => {
  const body = state.doc.child(0)
  return [...Array(body.childCount).keys()].map(
    (index) => body.child(index).textContent
  )
}

describe('Enter in the middle of text in Suggest mode', () => {
  it('proposes deleting the tail where it is and a copy of it in a new paragraph, as one split', () => {
    let state = caretAt(twoParagraphs(), 'first', 2)

    state = state.apply(suggestEnter(state, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Split paragraph',
    ])
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])
    expect(paragraphCount(state)).toBe(2)
    expect(paragraphTexts(state)).toEqual(['first', 'rst', 'second'])
  })

  it('accepting leaves two paragraphs and rejecting leaves the original one', () => {
    let state = caretAt(twoParagraphs(), 'first', 2)
    state = state.apply(suggestEnter(state, options))
    const id = suggestionCards(state.doc)[0]!.id

    const accepted = state.apply(
      decideSuggestion(state, id, 'accept').transaction
    )
    expect(paragraphTexts(accepted)).toEqual(['fi', 'rst', 'second'])
    expect(canonicalRuns(accepted.doc)).toEqual(['fi', 'rst', 'second'])
    expect(suggestionCards(accepted.doc)).toEqual([])

    const rejected = state.apply(
      decideSuggestion(state, id, 'reject').transaction
    )
    expect(paragraphTexts(rejected)).toEqual(['first', 'second'])
    expect(suggestionCards(rejected.doc)).toEqual([])
  })

  it("refuses when the tail holds someone else's suggestion", () => {
    const state = caretAt(
      stateOf(
        documentOf(
          paragraph('p1', [
            run('r1', ['ab', { text: 'cd', mark: 'insert', by: OTHER }]),
          ])
        )
      ),
      'ab',
      1
    )

    expect(() => suggestEnter(state, options)).toThrow(
      UnsupportedSuggestionError
    )
  })
})

describe('Backspace at the start of a paragraph in Suggest mode', () => {
  it('proposes deleting the second paragraph and a copy of its text at the end of the first, as one join', () => {
    let state = caretAt(twoParagraphs(), 'second', 0)
    const upper = joinTarget(state, false)
    expect(upper).not.toBeNull()

    state = state.apply(suggestJoin(state, upper!, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Join paragraphs',
    ])
    expect(canonicalRuns(state.doc)).toEqual(['first', 'second'])
    expect(paragraphTexts(state)).toEqual(['firstsecond', 'second'])
  })

  it('accepting leaves one paragraph and rejecting leaves two', () => {
    let state = caretAt(twoParagraphs(), 'second', 0)
    state = state.apply(suggestJoin(state, joinTarget(state, false)!, options))
    const id = suggestionCards(state.doc)[0]!.id

    const decision = decideSuggestion(state, id, 'accept')
    expect(decision.structuralDeletes).toEqual(['p2'])
    const accepted = state.apply(decision.transaction)
    expect(accepted.doc.child(0).child(0).textContent).toBe('firstsecond')

    const rejected = state.apply(
      decideSuggestion(state, id, 'reject').transaction
    )
    expect(paragraphTexts(rejected)).toEqual(['first', 'second'])
    expect(suggestionCards(rejected.doc)).toEqual([])
  })

  it('does not apply in the middle of a paragraph or in the first one', () => {
    expect(joinTarget(caretAt(twoParagraphs(), 'second', 2), false)).toBeNull()
    expect(joinTarget(caretAt(twoParagraphs(), 'first', 0), false)).toBeNull()
  })

  it('Delete at the end of a paragraph joins it with the next', () => {
    let state = caretAt(twoParagraphs(), 'first', 5)
    const upper = joinTarget(state, true)
    expect(upper).not.toBeNull()

    state = state.apply(suggestJoin(state, upper!, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Join paragraphs',
    ])
  })
})
