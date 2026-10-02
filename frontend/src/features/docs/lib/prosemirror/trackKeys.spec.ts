import { Fragment, Slice } from 'prosemirror-model'
import { TextSelection, type EditorState } from 'prosemirror-state'
import { ReplaceStep } from 'prosemirror-transform'
import { describe, expect, it } from 'vitest'
import { documentBodySchema } from './documentBody'
import {
  canonicalRuns,
  documentOf,
  ME,
  paragraph,
  positionIn,
  run,
  stateOf,
  suggestionsIn,
} from './suggestionTestKit'
import {
  suggestDeleteKey,
  trackTransaction,
  UnsupportedSuggestionError,
} from './trackChanges'

let counter = 0
const options = {
  author: ME,
  newID: () =>
    `00000000-0000-4000-8000-0000000007${String(counter++).padStart(2, '0')}`,
}

function caretAt(state: EditorState, needle: string, offset: number) {
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, positionIn(state.doc, needle, offset))
    )
  )
}

function press(state: EditorState, key: { forward: boolean; word?: boolean }) {
  return state.apply(suggestDeleteKey(state, state.selection, key, options))
}

const deletedText = (state: EditorState) =>
  suggestionsIn(state.doc)
    .filter((item) => item.kind === 'delete')
    .map((item) => [item.text, item.id])

describe('Backspace and Delete in Suggest mode', () => {
  it('marks the character before the caret and moves the caret before it', () => {
    let state = stateOf(documentOf(paragraph('p1', [run('r1', ['hello'])])))
    state = caretAt(state, 'hello', 5)

    state = press(state, { forward: false })

    expect(deletedText(state).map(([text]) => text)).toEqual(['o'])
    expect(state.selection.from).toBe(positionIn(state.doc, 'hello', 4))
    expect(canonicalRuns(state.doc)).toEqual(['hello'])
  })

  it('keeps pressing Backspace in one suggestion', () => {
    let state = stateOf(documentOf(paragraph('p1', [run('r1', ['hello'])])))
    state = caretAt(state, 'hello', 5)

    state = press(press(state, { forward: false }), { forward: false })

    const deleted = deletedText(state)
    expect(deleted.map(([text]) => text)).toEqual(['lo'])
    expect(new Set(deleted.map(([, id]) => id)).size).toBe(1)
  })

  it('moves over text that is already deleted and deletes the one before it', () => {
    const earlier = '00000000-0000-4000-8000-000000000799'
    let state = stateOf(
      documentOf(
        paragraph('p1', [
          run('r1', [
            'ab',
            { text: 'XY', mark: 'delete', by: ME, id: earlier },
          ]),
        ])
      )
    )
    state = caretAt(state, 'abXY', 4)

    state = press(state, { forward: false })

    // The 'b' joins the earlier suggestion, so the text under it is one piece.
    expect(deletedText(state)).toEqual([['bXY', earlier]])
  })

  it('marks the character after the caret for Delete and moves after it', () => {
    let state = stateOf(documentOf(paragraph('p1', [run('r1', ['hello'])])))
    state = caretAt(state, 'hello', 0)

    state = press(state, { forward: true })

    expect(deletedText(state).map(([text]) => text)).toEqual(['h'])
    expect(state.selection.from).toBe(positionIn(state.doc, 'hello', 1))
  })

  it('does nothing at the start of a paragraph', () => {
    let state = stateOf(documentOf(paragraph('p1', [run('r1', ['hello'])])))
    state = caretAt(state, 'hello', 0)

    const after = press(state, { forward: false })

    expect(suggestionsIn(after.doc)).toEqual([])
  })

  it('deletes a character outside the basic plane as one', () => {
    let state = stateOf(documentOf(paragraph('p1', [run('r1', ['a😀'])])))
    state = caretAt(state, 'a😀', 3)

    state = press(state, { forward: false })

    expect(deletedText(state).map(([text]) => text)).toEqual(['😀'])
  })

  it('deletes a whole word before the caret for Ctrl+Backspace', () => {
    let state = stateOf(
      documentOf(paragraph('p1', [run('r1', ['one two three'])]))
    )
    state = caretAt(state, 'one two three', 7)

    state = press(state, { forward: false, word: true })

    expect(deletedText(state).map(([text]) => text)).toEqual(['two'])
  })

  it('treats a selection inside one paragraph as a range', () => {
    let state = stateOf(
      documentOf(paragraph('p1', [run('r1', ['hello world'])]))
    )
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(
          state.doc,
          positionIn(state.doc, 'hello world', 5),
          positionIn(state.doc, 'hello world', 11)
        )
      )
    )

    state = press(state, { forward: false })

    expect(deletedText(state).map(([text]) => text)).toEqual([' world'])
  })
})

describe('edits the browser makes itself', () => {
  const state = () =>
    stateOf(documentOf(paragraph('p1', [run('r1', ['Hello'])])))

  it('records a plain text replacement, as an input method makes, as a suggestion', () => {
    const start = state()
    const at = positionIn(start.doc, 'Hello', 5)
    const transaction = start.tr.step(
      new ReplaceStep(
        at,
        at,
        new Slice(Fragment.from(documentBodySchema.text('é')), 0, 0)
      )
    )

    const tracked = trackTransaction(start, transaction, options)

    expect(
      suggestionsIn(start.apply(tracked).doc).map((item) => [
        item.text,
        item.kind,
      ])
    ).toEqual([['é', 'insert']])
  })

  it('refuses a transaction that is not a text change', () => {
    const start = state()
    const transaction = start.tr.split(positionIn(start.doc, 'Hello', 2))

    expect(() => trackTransaction(start, transaction, options)).toThrow(
      UnsupportedSuggestionError
    )
  })

  it('refuses format mark steps until Format suggestions exist', () => {
    const start = state()
    const from = positionIn(start.doc, 'Hello', 0)
    const strong = documentBodySchema.marks.strong!.create()
    const add = start.tr.addMark(from, from + 5, strong)
    expect(() => trackTransaction(start, add, options)).toThrow(
      UnsupportedSuggestionError
    )

    const bold = start.apply(add)
    const remove = bold.tr.removeMark(from, from + 5, strong)
    expect(() => trackTransaction(bold, remove, options)).toThrow(
      UnsupportedSuggestionError
    )
  })
})
