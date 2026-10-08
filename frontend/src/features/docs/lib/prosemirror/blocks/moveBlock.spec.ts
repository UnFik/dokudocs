import { EditorState } from 'prosemirror-state'
import { describe, expect, it } from 'vitest'
import { documentBodyToProseMirror } from '../documentBody'
import { prepareBodyTransaction } from '../prepareBodyTransaction'
import { moveTopLevelBlock } from './moveBlock'
import { bodyBuilder } from './testSupport'

function state() {
  const b = bodyBuilder()
  const root = b.add(null, 'document')
  const ids = ['a', 'b', 'c'].map((t) => {
    const p = b.add(root, 'paragraph')
    b.add(p, 'run', t)
    return p
  })
  return {
    root,
    ids,
    state: EditorState.create({ doc: documentBodyToProseMirror(b.nodes) }),
  }
}

describe('moveTopLevelBlock', () => {
  it('moves a dragged block to the end', () => {
    const s = state()
    const tr = prepareBodyTransaction(
      s.state,
      moveTopLevelBlock(s.state, 0, 3)!
    )
    expect(tr.doc.textContent).toBe('bca')
  })

  it('moves before a given sibling', () => {
    const s = state()
    const tr = prepareBodyTransaction(
      s.state,
      moveTopLevelBlock(s.state, 2, 0)!
    )
    expect(tr.doc.textContent).toBe('cab')
  })

  it('ignores moves that change nothing or are out of range', () => {
    const s = state()
    expect(moveTopLevelBlock(s.state, 1, 1)).toBeNull()
    expect(moveTopLevelBlock(s.state, 1, 2)).toBeNull()
    expect(moveTopLevelBlock(s.state, 5, 0)).toBeNull()
  })
})
