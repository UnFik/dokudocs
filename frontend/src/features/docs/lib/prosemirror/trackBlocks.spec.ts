import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { describe, expect, it } from 'vitest'
import { decideSuggestion } from './decideSuggestion'
import { suggestionCards, cardTitle } from './suggestionCards'
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
import { suggestDelete } from './trackChanges'

const ID = '00000000-0000-4000-8000-000000000601'
const options = { author: ME, newID: () => ID }

function blockSuggestions(doc: ProseMirrorNode) {
  const found: { nodeID: string; kind: string; id: string; author: string }[] =
    []
  doc.descendants((node) => {
    const attributes = JSON.parse(node.attrs.bodyAttributes ?? '{}')
    if (attributes.suggestion)
      found.push({
        nodeID: node.attrs.nodeID,
        kind: attributes.suggestion.kind,
        id: attributes.suggestion.id,
        author: attributes.suggestion.author,
      })
    return true
  })
  return found
}

const threeParagraphs = () =>
  documentOf(
    paragraph('p1', [run('r1', ['first paragraph'])]),
    paragraph('p2', [run('r2', ['middle paragraph'])]),
    paragraph('p3', [run('r3', ['last paragraph'])])
  )

describe('deleting across paragraphs in Suggest mode', () => {
  it('proposes deleting the paragraphs the selection covers and the text at its ends, as one suggestion', () => {
    const doc = threeParagraphs()
    const state = stateOf(doc)

    const next = state.apply(
      suggestDelete(
        state,
        positionIn(doc, 'first paragraph', 6),
        positionIn(doc, 'last paragraph', 4),
        options
      )
    )

    expect(blockSuggestions(next.doc)).toEqual([
      { nodeID: 'p2', kind: 'delete', id: ID, author: ME },
    ])
    expect(
      suggestionsIn(next.doc).map((item) => [item.text, item.kind, item.id])
    ).toEqual([
      ['paragraph', 'delete', ID],
      ['last', 'delete', ID],
    ])
    // Nothing canonical changed.
    expect(canonicalRuns(next.doc)).toEqual([
      'first paragraph',
      'middle paragraph',
      'last paragraph',
    ])
  })

  it('proposes deleting every paragraph for select all', () => {
    const doc = threeParagraphs()
    const state = stateOf(doc)

    const next = state.apply(
      suggestDelete(state, 1, doc.content.size - 1, options)
    )

    expect(blockSuggestions(next.doc).map((item) => item.nodeID)).toEqual([
      'p1',
      'p2',
      'p3',
    ])
    expect(canonicalRuns(next.doc)).toHaveLength(3)
  })

  it('is one card, named from the deleted text', () => {
    const doc = threeParagraphs()
    const state = stateOf(doc)
    const next = state.apply(
      suggestDelete(
        state,
        positionIn(doc, 'first paragraph', 6),
        positionIn(doc, 'last paragraph', 4),
        options
      )
    )

    const cards = suggestionCards(next.doc)

    expect(cards).toHaveLength(1)
    expect(cardTitle(cards[0]!)).toMatch(/^Delete: "/)
  })

  it('removes a paragraph you inserted yourself instead of marking it', () => {
    const insertedBlock = paragraph('p2', [run('r2', ['mine'])])
    const withSuggestion = insertedBlock.type.create(
      {
        ...insertedBlock.attrs,
        bodyAttributes: JSON.stringify({
          suggestion: { kind: 'insert', id: ID, author: ME },
        }),
      },
      insertedBlock.content
    )
    const doc = documentOf(
      paragraph('p1', [run('r1', ['canonical'])]),
      withSuggestion
    )
    const state = stateOf(doc)

    const next = state.apply(
      suggestDelete(state, 1, doc.content.size - 1, {
        author: ME,
        newID: () => 'unused',
      })
    )

    expect(
      blockSuggestions(next.doc).filter((item) => item.kind === 'insert')
    ).toEqual([])
    expect(next.doc.textContent).not.toContain('mine')
  })
})

describe('deciding a deletion that covers paragraphs', () => {
  const proposed = () => {
    const doc = threeParagraphs()
    const state = stateOf(doc)
    return state.apply(
      suggestDelete(
        state,
        positionIn(doc, 'first paragraph', 6),
        positionIn(doc, 'last paragraph', 4),
        options
      )
    )
  }

  it('hands a deleted paragraph to the structural delete when accepted', () => {
    const state = proposed()

    const { transaction, structuralDeletes } = decideSuggestion(
      state,
      ID,
      'accept'
    )
    const next = state.apply(transaction)

    expect(structuralDeletes).toEqual(['p2'])
    // The first and last paragraphs keep what the selection did not cover.
    expect(canonicalRuns(next.doc)[0]).toBe('first ')
    expect(canonicalRuns(next.doc).at(-1)).toBe(' paragraph')
  })

  it('keeps everything when rejected, and drops the proposal from the paragraph', () => {
    const state = proposed()

    const next = state.apply(decideSuggestion(state, ID, 'reject').transaction)

    expect(blockSuggestions(next.doc)).toEqual([])
    expect(suggestionsIn(next.doc)).toEqual([])
    expect(canonicalRuns(next.doc)).toEqual([
      'first paragraph',
      'middle paragraph',
      'last paragraph',
    ])
  })
})
