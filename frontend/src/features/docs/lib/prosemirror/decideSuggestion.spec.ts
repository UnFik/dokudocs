import { describe, expect, it } from 'vitest'
import { decideSuggestion } from './decideSuggestion'
import {
  canonicalRuns,
  documentOf,
  OTHER,
  paragraph,
  run,
  stateOf,
  suggestionsIn,
} from './suggestionTestKit'

const A = '00000000-0000-4000-8000-000000000501'
const B = '00000000-0000-4000-8000-000000000502'

function decide(
  doc: ReturnType<typeof documentOf>,
  id: string,
  decision: 'accept' | 'reject'
) {
  const state = stateOf(doc)
  const { transaction, structuralDeletes } = decideSuggestion(
    state,
    id,
    decision
  )
  return { next: state.apply(transaction), structuralDeletes }
}

describe('accepting', () => {
  it('turns a suggested insertion into canonical text', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', ['Hello', { text: ' big', mark: 'insert', id: A }, ' world']),
      ])
    )

    const { next, structuralDeletes } = decide(doc, A, 'accept')

    expect(suggestionsIn(next.doc)).toEqual([])
    expect(canonicalRuns(next.doc)).toEqual(['Hello big world'])
    expect(structuralDeletes).toEqual([])
  })

  it('removes text proposed for deletion', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', ['Keep ', { text: 'drop', mark: 'delete', id: A }, ' end']),
      ])
    )

    const { next, structuralDeletes } = decide(doc, A, 'accept')

    expect(canonicalRuns(next.doc)).toEqual(['Keep  end'])
    expect(suggestionsIn(next.doc)).toEqual([])
    expect(structuralDeletes).toEqual([])
  })

  it('does both halves of a Replace', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [
          'a ',
          { text: 'cat', mark: 'delete', id: A },
          { text: 'dog', mark: 'insert', id: A },
          ' sat',
        ]),
      ])
    )

    const { next } = decide(doc, A, 'accept')

    expect(canonicalRuns(next.doc)).toEqual(['a dog sat'])
    expect(suggestionsIn(next.doc)).toEqual([])
  })

  it('hands a deleted whole run to the structural delete instead of removing it', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', ['keep']),
        run('r2', [{ text: 'all of this run', mark: 'delete', id: A }]),
      ])
    )

    const { next, structuralDeletes } = decide(doc, A, 'accept')

    expect(structuralDeletes).toEqual(['r2'])
    // The run still exists: a canonical node goes through DeleteNode, not an edit.
    expect(next.doc.textContent).toContain('all of this run')
  })

  it('leaves other suggestions alone', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [
          { text: 'mine', mark: 'insert', id: A },
          ' and ',
          { text: 'theirs', mark: 'insert', by: OTHER, id: B },
        ]),
      ])
    )

    const { next } = decide(doc, A, 'accept')

    expect(suggestionsIn(next.doc).map((item) => item.id)).toEqual([B])
  })
})

describe('rejecting', () => {
  it('removes a suggested insertion', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', ['Hello', { text: ' big', mark: 'insert', id: A }, ' world']),
      ])
    )

    const { next } = decide(doc, A, 'reject')

    expect(next.doc.textContent).toBe('Hello world')
    expect(suggestionsIn(next.doc)).toEqual([])
  })

  it('removes a run that was only the insertion', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', ['before']),
        run('r2', [{ text: ' typed', mark: 'insert', id: A }]),
      ])
    )

    const { next } = decide(doc, A, 'reject')

    const runs: string[] = []
    next.doc.descendants((node) => {
      if (node.type.name === 'run') runs.push(node.attrs.nodeID)
    })
    expect(runs).toEqual(['r1'])
  })

  it('keeps text proposed for deletion and drops the proposal', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', ['Keep ', { text: 'drop', mark: 'delete', id: A }]),
      ])
    )

    const { next } = decide(doc, A, 'reject')

    expect(canonicalRuns(next.doc)).toEqual(['Keep drop'])
    expect(suggestionsIn(next.doc)).toEqual([])
  })

  it('takes someone else’s edit inside the insertion along with it', () => {
    const doc = documentOf(
      paragraph('p1', [
        run('r1', [
          'Hello ',
          { text: 'big ', mark: 'insert', id: A },
          { text: 'really ', mark: 'insert', by: OTHER, id: B },
          { text: 'wide', mark: 'insert', id: A },
          ' world',
        ]),
      ])
    )

    const { next } = decide(doc, A, 'reject')

    expect(next.doc.textContent).toBe('Hello  world')
    expect(suggestionsIn(next.doc)).toEqual([])
  })
})
