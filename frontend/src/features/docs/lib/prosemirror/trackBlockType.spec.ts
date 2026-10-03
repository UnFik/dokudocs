import { TextSelection, type EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { decideSuggestion } from './decideSuggestion'
import { documentBodySchema } from './documentBody'
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
import { blockLevel, suggestBlockType } from './trackBlockType'
import { UnsupportedSuggestionError } from './trackChanges'

let counter = 0
const options = {
  author: ME,
  newID: () =>
    `00000000-0000-4000-8000-0000000010${String(counter++).padStart(2, '0')}`,
}

const heading = (nodeID: string, level: number, text: string) =>
  documentBodySchema.nodes.atx_heading!.create(
    {
      nodeID,
      bodyAttributes: JSON.stringify({ level }),
      bodyContent: '',
    },
    [run(`${nodeID}-run`, [text])]
  )

function caretIn(state: EditorState, needle: string) {
  return state.apply(
    state.tr.setSelection(
      TextSelection.create(state.doc, positionIn(state.doc, needle, 1))
    )
  )
}

const blockTypes = (state: EditorState) => {
  const found: string[] = []
  state.doc.child(0).forEach((node) => {
    found.push(`${node.type.name}:${blockLevel(node)}`)
  })
  return found
}

const plain = () => stateOf(documentOf(paragraph('p1', [run('r1', ['Title'])])))

describe('block types in Suggest mode', () => {
  it('proposes a heading and leaves the block a paragraph', () => {
    let state = caretIn(plain(), 'Title')

    state = state.apply(suggestBlockType(state, 2, options))

    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Format: heading 2 "Title"',
    ])
    expect(blockTypes(state)).toEqual(['paragraph:0'])
  })

  it('accepting makes it a heading of that level, and rejecting leaves a paragraph', () => {
    let state = caretIn(plain(), 'Title')
    state = state.apply(suggestBlockType(state, 3, options))
    const id = suggestionCards(state.doc)[0]!.id

    const accepted = state.apply(
      decideSuggestion(state, id, 'accept').transaction
    )
    expect(blockTypes(accepted)).toEqual(['atx_heading:3'])
    expect(suggestionCards(accepted.doc)).toEqual([])
    expect(accepted.doc.textContent).toBe('Title')

    const rejected = state.apply(
      decideSuggestion(state, id, 'reject').transaction
    )
    expect(blockTypes(rejected)).toEqual(['paragraph:0'])
    expect(suggestionCards(rejected.doc)).toEqual([])
  })

  it('proposes changing a heading level and turning it back into a paragraph', () => {
    const doc = documentOf(heading('h1', 1, 'Title'))
    let state = caretIn(stateOf(doc), 'Title')

    state = state.apply(suggestBlockType(state, 4, options))
    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Format: heading 4 "Title"',
    ])
    const levelCard = suggestionCards(state.doc)[0]!
    expect(
      blockTypes(
        state.apply(decideSuggestion(state, levelCard.id, 'accept').transaction)
      )
    ).toEqual(['atx_heading:4'])

    let paragraphState = caretIn(stateOf(doc), 'Title')
    paragraphState = paragraphState.apply(
      suggestBlockType(paragraphState, 0, options)
    )
    expect(suggestionCards(paragraphState.doc).map(cardTitle)).toEqual([
      'Format: paragraph "Title"',
    ])
    const accepted = paragraphState.apply(
      decideSuggestion(
        paragraphState,
        suggestionCards(paragraphState.doc)[0]!.id,
        'accept'
      ).transaction
    )
    expect(blockTypes(accepted)).toEqual(['paragraph:0'])
  })

  it('a second proposal replaces the first, and asking for the current type takes it back', () => {
    let state = caretIn(plain(), 'Title')
    state = state.apply(suggestBlockType(state, 2, options))
    state = state.apply(suggestBlockType(state, 5, options))
    expect(suggestionCards(state.doc).map(cardTitle)).toEqual([
      'Format: heading 5 "Title"',
    ])

    state = state.apply(suggestBlockType(state, 0, options))
    expect(suggestionCards(state.doc)).toEqual([])
  })

  it('changes your own inserted block for real', () => {
    const inserted = documentBodySchema.nodes.paragraph!.create(
      {
        nodeID: 'p1',
        bodyAttributes: JSON.stringify({
          suggestion: { kind: 'insert', id: 'x', author: ME },
        }),
        bodyContent: '',
      },
      [run('r1', ['New'])]
    )
    let state = caretIn(stateOf(documentOf(inserted)), 'New')

    state = state.apply(suggestBlockType(state, 2, options))

    expect(blockTypes(state)).toEqual(['atx_heading:2'])
  })

  it("refuses a block under someone else's suggestion, and a block that is not text", () => {
    const theirs = documentBodySchema.nodes.paragraph!.create(
      {
        nodeID: 'p1',
        bodyAttributes: JSON.stringify({
          suggestion: {
            kind: 'format',
            id: '00000000-0000-4000-8000-0000000010a1',
            author: OTHER,
            toType: 'atx_heading',
            toAttributes: { level: 1 },
          },
        }),
        bodyContent: '',
      },
      [run('r1', ['Theirs'])]
    )
    const state = caretIn(stateOf(documentOf(theirs)), 'Theirs')

    expect(() => suggestBlockType(state, 2, options)).toThrow(
      UnsupportedSuggestionError
    )
  })
})
