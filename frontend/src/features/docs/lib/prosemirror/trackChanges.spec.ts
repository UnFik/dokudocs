import { describe, expect, it } from 'vitest'
import {
  canonicalRuns,
  documentOf,
  ME,
  OTHER,
  paragraph,
  positionIn,
  run,
  stateOf,
  suggestionsIn,
} from './suggestionTestKit'
import { suggestReplace, UnsupportedSuggestionError } from './trackChanges'

const newID = () => '00000000-0000-4000-8000-0000000000f1'

describe('typing in Suggest mode', () => {
  it('adds the text as a suggested insertion and leaves the canonical body alone', () => {
    const doc = documentOf(paragraph('p1', [run('r1', ['Hello'])]))
    const state = stateOf(doc)
    const end = positionIn(doc, 'Hello', 5)

    const next = state.apply(
      suggestReplace(state, end, end, ' world', { author: ME, newID })
    )

    expect(suggestionsIn(next.doc)).toEqual([
      { text: ' world', kind: 'insert', author: ME, id: newID() },
    ])
    expect(canonicalRuns(next.doc)).toEqual(['Hello'])
  })

  it('types into the middle of a run without splitting it', () => {
    const doc = documentOf(paragraph('p1', [run('r1', ['HelloWorld'])]))
    const state = stateOf(doc)
    const middle = positionIn(doc, 'HelloWorld', 5)

    const next = state.apply(
      suggestReplace(state, middle, middle, ' ', { author: ME, newID })
    )

    expect(canonicalRuns(next.doc)).toEqual(['HelloWorld'])
    const runs: string[] = []
    next.doc.descendants((node) => {
      if (node.type.name === 'run') runs.push(node.attrs.nodeID)
    })
    expect(runs).toEqual(['r1'])
  })

  it('keeps consecutive typing in one suggestion', () => {
    const doc = documentOf(paragraph('p1', [run('r1', ['Hello'])]))
    let state = stateOf(doc)
    const ids = ['id-1', 'id-2'].map(
      (_, index) => `00000000-0000-4000-8000-00000000010${index}`
    )
    let next = 0
    const options = { author: ME, newID: () => ids[next++]! }
    let position = positionIn(doc, 'Hello', 5)

    for (const character of ' go') {
      state = state.apply(
        suggestReplace(state, position, position, character, options)
      )
      position += 1
    }

    expect(suggestionsIn(state.doc)).toEqual([
      { text: ' go', kind: 'insert', author: ME, id: ids[0] },
    ])
  })

  it('starts a new suggestion when the caret moved away from the last one', () => {
    const doc = documentOf(paragraph('p1', [run('r1', ['Hello there'])]))
    let state = stateOf(doc)
    const ids = [
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102',
    ]
    let next = 0
    const options = { author: ME, newID: () => ids[next++]! }

    state = state.apply(
      suggestReplace(
        state,
        positionIn(state.doc, 'Hello', 5),
        positionIn(state.doc, 'Hello', 5),
        'A',
        options
      )
    )
    // One character away from the end of the insertion.
    const away = positionIn(state.doc, 'there', 2)
    state = state.apply(suggestReplace(state, away, away, 'B', options))

    expect(
      suggestionsIn(state.doc).map((item) => [item.text, item.id])
    ).toEqual([
      ['A', ids[0]],
      ['B', ids[1]],
    ])
  })
})

describe('deleting in Suggest mode', () => {
  it('marks canonical text as deleted and leaves it in place', () => {
    const doc = documentOf(paragraph('p1', [run('r1', ['Hello world'])]))
    const state = stateOf(doc)
    const from = positionIn(doc, 'Hello world', 5)

    const next = state.apply(
      suggestReplace(state, from, from + 6, '', { author: ME, newID })
    )

    expect(suggestionsIn(next.doc)).toEqual([
      { text: ' world', kind: 'delete', author: ME, id: newID() },
    ])
    expect(canonicalRuns(next.doc)).toEqual(['Hello world'])
    expect(next.doc.textContent).toBe('Hello world')
  })
})

describe('editing a suggestion', () => {
  const MINE = '00000000-0000-4000-8000-000000000201'
  const THEIRS = '00000000-0000-4000-8000-000000000202'

  it('really removes text from your own insertion, leaving no trace', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [
          'Hello',
          { text: ' big', mark: 'insert', id: MINE },
          ' world',
        ]),
      ])
    )
    const state = stateOf(doc)
    const from = positionIn(doc, ' big', 0)

    const next = state.apply(
      suggestReplace(state, from, from + 4, '', { author: ME, newID })
    )

    expect(suggestionsIn(next.doc)).toEqual([])
    expect(next.doc.textContent).toBe('Hello world')
    expect(canonicalRuns(next.doc)).toEqual(['Hello world'])
  })

  it('removes the whole run when your insertion was all of it', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', ['before']),
        run('r2', [{ text: ' typed', mark: 'insert', id: MINE }]),
      ])
    )
    const state = stateOf(doc)
    const from = positionIn(doc, ' typed', 0)

    const next = state.apply(
      suggestReplace(state, from, from + 6, '', { author: ME, newID })
    )

    const runs: string[] = []
    next.doc.descendants((node) => {
      if (node.type.name === 'run') runs.push(node.attrs.nodeID)
    })
    expect(runs).toEqual(['r1'])
    expect(canonicalRuns(next.doc)).toEqual(['before'])
  })

  it('proposes deleting text someone else inserted, keeping their insertion', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [
          'Hello',
          { text: ' theirs', mark: 'insert', by: OTHER, id: THEIRS },
        ]),
      ])
    )
    const state = stateOf(doc)
    const from = positionIn(doc, ' theirs', 0)

    const next = state.apply(
      suggestReplace(state, from, from + 7, '', { author: ME, newID })
    )

    expect(suggestionsIn(next.doc)).toEqual([
      { text: ' theirs', kind: 'insert', author: OTHER, id: THEIRS },
      { text: ' theirs', kind: 'delete', author: ME, id: newID() },
    ])
  })

  it('does nothing when the text is already deleted', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [
          'Keep ',
          { text: 'gone', mark: 'delete', by: OTHER, id: THEIRS },
        ]),
      ])
    )
    const state = stateOf(doc)
    const from = positionIn(doc, 'gone', 0)

    const transaction = suggestReplace(state, from, from + 4, '', {
      author: ME,
      newID,
    })

    expect(transaction.docChanged).toBe(false)
  })
})

describe('Replace', () => {
  it('is one suggestion when text is deleted and then typed right where it was', () => {
    const doc = documentOf(paragraph('p1', [run('r1', ['a cat sat'])]))
    let state = stateOf(doc)
    const ids = [
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000302',
    ]
    let next = 0
    const options = { author: ME, newID: () => ids[next++]! }
    const from = positionIn(doc, 'a cat sat', 2)

    state = state.apply(
      suggestReplace(state, from, from + 3, '', { ...options, caret: 'end' })
    )
    const caret = state.selection.from
    state = state.apply(suggestReplace(state, caret, caret, 'dog', options))

    expect(
      suggestionsIn(state.doc).map((item) => [item.text, item.kind, item.id])
    ).toEqual([
      ['cat', 'delete', ids[0]],
      ['dog', 'insert', ids[0]],
    ])
  })

  it('is also one suggestion when text is typed and the character next to it is deleted', () => {
    const doc = documentOf(paragraph('p1', [run('r1', ['abcdef'])]))
    let state = stateOf(doc)
    const ids = [
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000302',
    ]
    let next = 0
    const options = { author: ME, newID: () => ids[next++]! }
    const at = positionIn(doc, 'abcdef', 3)

    state = state.apply(suggestReplace(state, at, at, 'X', options))
    // The character after the typed text.
    const after = state.selection.from
    state = state.apply(suggestReplace(state, after, after + 1, '', options))

    expect(
      suggestionsIn(state.doc).map((item) => [item.text, item.kind, item.id])
    ).toEqual([
      ['X', 'insert', ids[0]],
      ['d', 'delete', ids[0]],
    ])
  })

  it('is a separate suggestion when the caret has moved a character away', () => {
    const doc = documentOf(paragraph('p1', [run('r1', ['abcdef'])]))
    let state = stateOf(doc)
    const ids = [
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000302',
    ]
    let next = 0
    const options = { author: ME, newID: () => ids[next++]! }
    const at = positionIn(doc, 'abcdef', 1)

    state = state.apply(
      suggestReplace(state, at, at + 1, '', { ...options, caret: 'end' })
    )
    // Skips one character, so the next edit does not touch the first.
    const apart = positionIn(state.doc, 'def', 0)
    state = state.apply(suggestReplace(state, apart, apart, 'Z', options))

    expect(suggestionsIn(state.doc).map((item) => item.id)).toEqual([
      ids[0],
      ids[1],
    ])
  })
})

describe('formatting and limits', () => {
  it('gives typed text the formatting around it', () => {
    const doc = documentOf(
      paragraph('p1', [run('r1', [{ text: 'bold', bold: true }])])
    )
    const state = stateOf(doc)
    const end = positionIn(doc, 'bold', 4)

    const next = state.apply(
      suggestReplace(state, end, end, '!', { author: ME, newID })
    )

    let marked: string[] = []
    next.doc.descendants((node) => {
      if (node.isText && node.text === '!')
        marked = node.marks.map((mark) => mark.type.name).sort()
    })
    expect(marked).toEqual(['strong', 'suggestion_insert'])
  })

  it('refuses a change that spans paragraphs', () => {
    const doc = documentOf(
      paragraph('p1', [run('r1', ['first'])]),
      paragraph('p2', [run('r2', ['second'])])
    )
    const state = stateOf(doc)

    expect(() =>
      suggestReplace(
        state,
        positionIn(doc, 'first', 2),
        positionIn(doc, 'second', 2),
        '',
        {
          author: ME,
          newID,
        }
      )
    ).toThrow(UnsupportedSuggestionError)
  })
})
